//go:build windows

package providerworker

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

type ExecRunner struct{}

const createNoWindow = 0x08000000

func hiddenCommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	return cmd
}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := hiddenCommandContext(ctx, name, args...)
	b, err := cmd.CombinedOutput()
	out := strings.TrimSpace(decodeWindowsOutput(b))
	if err != nil {
		return out, fmt.Errorf("%s: %w", out, err)
	}
	return out, nil
}

type Server struct {
	Socket, DataDir string
	Runner          Runner
}

var windowsSafeID = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,96}$`)

func (s Server) Serve(ctx context.Context) error {
	if s.Socket == "" {
		s.Socket = DefaultSocket
	}
	if s.DataDir == "" {
		root, _ := os.UserCacheDir()
		s.DataDir = filepath.Join(root, "ExoraDock", "provider")
	}
	if s.Runner == nil {
		s.Runner = ExecRunner{}
	}
	if err := os.MkdirAll(s.DataDir, 0700); err != nil {
		return err
	}
	current, err := user.Current()
	if err != nil {
		return err
	}
	sddl := fmt.Sprintf("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;%s)", current.Uid)
	ln, err := winio.ListenPipe(s.Socket, &winio.PipeConfig{SecurityDescriptor: sddl, MessageMode: true, InputBufferSize: 1 << 20, OutputBufferSize: 1 << 20})
	if err != nil {
		return err
	}
	defer ln.Close()
	go func() { <-ctx.Done(); _ = ln.Close() }()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go handleConnection(ctx, conn, s.dispatch, s.audit)
	}
}

func (s Server) audit(command string, ok bool, message string) {
	record, _ := json.Marshal(map[string]any{"time": time.Now().UTC(), "command": command, "ok": ok, "error": message})
	f, err := os.OpenFile(filepath.Join(s.DataDir, "audit.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err == nil {
		_, _ = f.Write(append(record, '\n'))
		_ = f.Close()
	}
}

func winString(in map[string]any, key string) string {
	value, _ := in[key].(string)
	return strings.TrimSpace(value)
}
func winBool(in map[string]any, key string) bool { value, _ := in[key].(bool); return value }
func winInt64(in map[string]any, key string) int64 {
	switch value := in[key].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case json.Number:
		n, _ := value.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(value, 10, 64)
		return n
	}
	return 0
}

func (s Server) managedPath(group, name string) (string, error) {
	if !windowsSafeID.MatchString(name) {
		return "", fmt.Errorf("invalid id")
	}
	root, err := filepath.Abs(filepath.Join(s.DataDir, group))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	p, err := filepath.Abs(filepath.Join(root, name))
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(strings.ToLower(p), strings.ToLower(root+string(os.PathSeparator))) {
		return "", fmt.Errorf("path escapes managed directory")
	}
	return p, nil
}

func pathWithin(root, candidate string) bool {
	root = strings.ToLower(filepath.Clean(root))
	candidate = strings.ToLower(filepath.Clean(candidate))
	return candidate == root || strings.HasPrefix(candidate, root+string(os.PathSeparator))
}

func (s Server) environmentRoot(in map[string]any) (string, error) {
	raw := strings.TrimSpace(winString(in, "environmentRoot"))
	if raw == "" || !filepath.IsAbs(raw) {
		return "", fmt.Errorf("environmentRoot must be an absolute path")
	}
	root, err := filepath.Abs(raw)
	if err != nil {
		return "", err
	}
	imagesRoot, err := filepath.Abs(filepath.Join(s.DataDir, "images"))
	if err != nil {
		return "", err
	}
	if pathWithin(root, imagesRoot) || pathWithin(imagesRoot, root) {
		return "", fmt.Errorf("environment root must be separate from the managed image cache")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(root, ".exora-environment-root"), []byte("exora.environment_root.v1\n"), 0600); err != nil {
		return "", fmt.Errorf("write environment root marker: %w", err)
	}
	return root, nil
}

func environmentChild(root string, parts ...string) (string, error) {
	values := append([]string{root}, parts...)
	abs, err := filepath.Abs(filepath.Join(values...))
	if err != nil {
		return "", err
	}
	if !pathWithin(root, abs) {
		return "", fmt.Errorf("environment path escapes selected root")
	}
	return abs, nil
}

func exoraDistroName(id string) (string, error) {
	if !windowsSafeID.MatchString(id) {
		return "", fmt.Errorf("invalid environment id")
	}
	name := "Exora-" + id
	if !strings.HasPrefix(name, "Exora-") {
		return "", fmt.Errorf("invalid Exora distribution")
	}
	return name, nil
}

func (s Server) dispatch(ctx context.Context, command string, input map[string]any) (map[string]any, error) {
	switch command {
	case "probe_host", "probe_runtime":
		return s.probeRuntime(ctx)
	case "list_domains", "list_environment_images":
		return s.listImages(ctx)
	case "import_template", "import_environment_image":
		return s.importImage(ctx, input)
	case "validate_template", "validate_environment_image":
		return s.validateImage(ctx, input)
	case "delete_template", "delete_environment_image":
		return s.deleteImage(ctx, input)
	case "reserve_disk":
		return s.reserveDisk(ctx, input)
	case "release_disk":
		return s.releaseDisk(input)
	case "capacity_check":
		return s.capacity(ctx)
	case "lease_recheck":
		return persistentWorkerCommand(s.DataDir, command, input, func() (map[string]any, error) { return s.leaseRecheck(ctx, input) })
	case "provision_lease":
		return persistentWorkerCommand(s.DataDir, command, input, func() (map[string]any, error) { return s.provisionLease(ctx, input) })
	case "renew_lease_epoch":
		return persistentWorkerCommand(s.DataDir, command, input, func() (map[string]any, error) { return s.renewLease(ctx, input) })
	case "reset_lease":
		return persistentWorkerCommand(s.DataDir, command, input, func() (map[string]any, error) { return s.resetLease(ctx, input) })
	default:
		return nil, fmt.Errorf("unsupported command on Windows WSL backend")
	}
}

func (s Server) probeRuntime(ctx context.Context) (map[string]any, error) {
	version, versionErr := s.Runner.Run(ctx, "wsl.exe", "--version")
	status, _ := s.Runner.Run(ctx, "wsl.exe", "--status")
	gpu, _ := s.Runner.Run(ctx, "nvidia-smi.exe", "--query-gpu=name,uuid,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits")
	hardware, _ := s.Runner.Run(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$c=Get-CimInstance Win32_Processor|Select-Object -First 1;$o=Get-CimInstance Win32_OperatingSystem;$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\";[pscustomobject]@{Cpu=$c.Name;Cores=$c.NumberOfCores;LogicalProcessors=$c.NumberOfLogicalProcessors;MemoryBytes=[int64]$o.TotalVisibleMemorySize*1024;FreeMemoryBytes=[int64]$o.FreePhysicalMemory*1024;DiskBytes=[int64]$d.Size;FreeDiskBytes=[int64]$d.FreeSpace}|ConvertTo-Json -Compress")
	disk, diskErr := s.benchmarkDisk(ctx)
	installed := versionErr == nil
	state := "runtime_ready"
	if !installed {
		state = "runtime_missing"
	}
	result := map[string]any{"hostOS": "windows", "architecture": "amd64", "runtimeBackend": "wsl2", "runtimeInstalled": installed, "runtimeState": state, "version": version, "status": status, "gpu": gpu, "hardware": hardware, "experimental": true, "isolationClass": "experimental_shared_host"}
	if diskErr == nil {
		result["disk"] = disk
	} else {
		result["disk"] = map[string]any{"error": diskErr.Error()}
	}
	return result, nil
}

func alignedBlock(size, alignment int) []byte {
	raw := make([]byte, size+alignment)
	address := uintptr(unsafe.Pointer(&raw[0]))
	offset := int((uintptr(alignment) - address%uintptr(alignment)) % uintptr(alignment))
	return raw[offset : offset+size]
}

func (s Server) benchmarkDisk(ctx context.Context) (map[string]any, error) {
	if err := os.MkdirAll(s.DataDir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(s.DataDir, fmt.Sprintf(".disk-benchmark-%d.tmp", time.Now().UnixNano()))
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(pathPtr, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.CREATE_ALWAYS, windows.FILE_ATTRIBUTE_TEMPORARY|windows.FILE_FLAG_NO_BUFFERING|windows.FILE_FLAG_WRITE_THROUGH|windows.FILE_FLAG_SEQUENTIAL_SCAN, 0)
	if err != nil {
		return nil, fmt.Errorf("create benchmark file: %w", err)
	}
	defer windows.CloseHandle(handle)
	defer os.Remove(path)

	const totalBytes = 256 * 1024 * 1024
	const blockBytes = 4 * 1024 * 1024
	block := alignedBlock(blockBytes, 4096)
	for index := range block {
		block[index] = byte((index*31 + 17) & 0xff)
	}

	writeStarted := time.Now()
	for written := 0; written < totalBytes; written += blockBytes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var count uint32
		if err := windows.WriteFile(handle, block, &count, nil); err != nil || count != blockBytes {
			if err == nil {
				err = io.ErrShortWrite
			}
			return nil, fmt.Errorf("benchmark write: %w", err)
		}
	}
	if err := windows.FlushFileBuffers(handle); err != nil {
		return nil, fmt.Errorf("flush benchmark file: %w", err)
	}
	writeDuration := time.Since(writeStarted)

	position, err := windows.SetFilePointer(handle, 0, nil, windows.FILE_BEGIN)
	if err != nil || position != 0 {
		return nil, fmt.Errorf("rewind benchmark file: %w", err)
	}
	readStarted := time.Now()
	for read := 0; read < totalBytes; read += blockBytes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var count uint32
		if err := windows.ReadFile(handle, block, &count, nil); err != nil || count != blockBytes {
			if err == nil {
				err = io.ErrUnexpectedEOF
			}
			return nil, fmt.Errorf("benchmark read: %w", err)
		}
	}
	readDuration := time.Since(readStarted)
	megabytes := float64(totalBytes) / (1024 * 1024)
	return map[string]any{
		"readMBps":       megabytes / readDuration.Seconds(),
		"writeMBps":      megabytes / writeDuration.Seconds(),
		"benchmarkBytes": totalBytes,
		"measuredAt":     time.Now().UTC().Format(time.RFC3339),
		"mode":           "sequential_unbuffered",
	}, nil
}

func (s Server) listImages(ctx context.Context) (map[string]any, error) {
	out, err := s.Runner.Run(ctx, "wsl.exe", "--list", "--quiet")
	if err != nil {
		return map[string]any{"environments": []any{}}, nil
	}
	items := []map[string]any{}
	for _, line := range strings.Fields(strings.ReplaceAll(out, "\x00", "")) {
		if strings.HasPrefix(line, "Exora-") {
			items = append(items, map[string]any{"name": line, "environmentId": strings.TrimPrefix(line, "Exora-"), "managed": true})
		}
	}
	return map[string]any{"environments": items}, nil
}

func (s Server) importImage(ctx context.Context, in map[string]any) (map[string]any, error) {
	id := winString(in, "environmentId")
	name, err := exoraDistroName(id)
	if err != nil {
		return nil, err
	}
	artifact := winString(in, "artifactPath")
	imagesRoot, err := filepath.Abs(filepath.Join(s.DataDir, "images"))
	if err != nil {
		return nil, err
	}
	artifactAbs, err := filepath.Abs(artifact)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(strings.ToLower(artifactAbs), strings.ToLower(imagesRoot+string(os.PathSeparator))) || strings.ToLower(filepath.Ext(artifactAbs)) != ".wsl" {
		return nil, fmt.Errorf("artifact must be a managed .wsl file")
	}
	if _, err := os.Stat(artifactAbs); err != nil {
		return nil, fmt.Errorf("environment artifact: %w", err)
	}
	root, err := s.environmentRoot(in)
	if err != nil {
		return nil, err
	}
	installPath, err := environmentChild(root, "instances", id)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(installPath, 0700); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "wsl.exe", "--import", name, installPath, artifactAbs, "--version", "2"); err != nil {
		_ = os.RemoveAll(installPath)
		return nil, err
	}
	return map[string]any{"environmentId": id, "distribution": name, "installPath": installPath, "status": "imported"}, nil
}

func (s Server) validateImage(ctx context.Context, in map[string]any) (map[string]any, error) {
	id := winString(in, "environmentId")
	name, err := exoraDistroName(id)
	if err != nil {
		return nil, err
	}
	conf, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "cat", "/etc/wsl.conf")
	if err != nil {
		return nil, fmt.Errorf("wsl.conf validation: %w", err)
	}
	secure := strings.Contains(conf, "enabled=false") && strings.Contains(conf, "mountFsTab=false") && strings.Contains(conf, "appendWindowsPath=false")
	if !secure {
		return nil, fmt.Errorf("environment permits Windows automount or interop")
	}
	contract, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "cat", "/usr/lib/exora/guest-contract.json")
	if err != nil || !strings.Contains(contract, "exora.guest_contract") {
		return nil, fmt.Errorf("Exora Guest Contract missing")
	}
	kernel, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "uname", "-a")
	if err != nil {
		return nil, err
	}
	_, _ = s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "ssh-keygen", "-A")
	if _, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "sshd", "-t"); err != nil {
		return nil, fmt.Errorf("SSH validation: %w", err)
	}
	report := map[string]any{"environmentId": id, "distribution": name, "security": true, "guestContract": true, "kernel": kernel, "ssh": true, "runtimeBackend": "wsl2", "status": "ready"}
	if winBool(in, "cudaRequired") {
		if _, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "test", "-e", "/dev/dxg"); err != nil {
			return nil, fmt.Errorf("WSL GPU device unavailable")
		}
		nvidia, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "/usr/lib/wsl/lib/nvidia-smi")
		if err != nil {
			return nil, fmt.Errorf("nvidia-smi validation: %w", err)
		}
		nvcc, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "nvcc", "--version")
		if err != nil {
			return nil, fmt.Errorf("CUDA Toolkit validation: %w", err)
		}
		if _, err := s.Runner.Run(ctx, "wsl.exe", "-d", name, "--exec", "/usr/lib/exora/cuda-smoke-test"); err != nil {
			return nil, fmt.Errorf("CUDA smoke test: %w", err)
		}
		report["cuda"] = true
		report["nvidiaSmi"] = nvidia
		report["nvcc"] = nvcc
	}
	return report, nil
}

func (s Server) deleteImage(ctx context.Context, in map[string]any) (map[string]any, error) {
	id := winString(in, "environmentId")
	name, err := exoraDistroName(id)
	if err != nil {
		return nil, err
	}
	_, _ = s.Runner.Run(ctx, "wsl.exe", "--terminate", name)
	if _, err := s.Runner.Run(ctx, "wsl.exe", "--unregister", name); err != nil {
		return nil, err
	}
	root, err := s.environmentRoot(in)
	if err != nil {
		return nil, err
	}
	path, err := environmentChild(root, "instances", id)
	if err == nil {
		_ = os.RemoveAll(path)
	}
	return map[string]any{"environmentId": id, "deleted": true}, nil
}

func (s Server) reserveDisk(ctx context.Context, in map[string]any) (map[string]any, error) {
	slot := winString(in, "slotId")
	size := winInt64(in, "sizeBytes")
	if size <= 0 {
		return nil, fmt.Errorf("sizeBytes must be positive")
	}
	root, err := s.environmentRoot(in)
	if err != nil {
		return nil, err
	}
	path, err := environmentChild(root, "reservations", slot+".reserve")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if info, err := os.Stat(path); err == nil {
		if info.Size() != size {
			return nil, fmt.Errorf("reservation exists with different size")
		}
		return map[string]any{"path": path, "sizeBytes": size, "reserved": true, "created": false}, nil
	}
	const minimumSystemReserve = int64(10 * 1024 * 1024 * 1024)
	requiredFree := winInt64(in, "requiredFreeBytes")
	if requiredFree < minimumSystemReserve {
		requiredFree = minimumSystemReserve
	}
	rootPtr, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return nil, fmt.Errorf("invalid environment root: %w", err)
	}
	var available uint64
	var total uint64
	var totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(rootPtr, &available, &total, &totalFree); err != nil {
		return nil, fmt.Errorf("read environment disk capacity: %w", err)
	}
	if uint64(size)+uint64(requiredFree) > available {
		return nil, fmt.Errorf("insufficient disk capacity: requested %d bytes with %d bytes reserved, but only %d bytes are available", size, requiredFree, available)
	}
	if _, err := s.Runner.Run(ctx, "fsutil.exe", "file", "createnew", path, strconv.FormatInt(size, 10)); err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "sizeBytes": size, "requiredFreeBytes": requiredFree, "availableBeforeBytes": available, "reserved": true, "created": true}, nil
}

func (s Server) releaseDisk(in map[string]any) (map[string]any, error) {
	slot := winString(in, "slotId")
	root, err := s.environmentRoot(in)
	if err != nil {
		return nil, err
	}
	path, err := environmentChild(root, "reservations", slot+".reserve")
	if err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return map[string]any{"path": path, "released": true}, nil
}

func (s Server) capacity(ctx context.Context) (map[string]any, error) {
	memory, _ := s.Runner.Run(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{TotalBytes=[int64]$o.TotalVisibleMemorySize*1024;FreeBytes=[int64]$o.FreePhysicalMemory*1024}|ConvertTo-Json -Compress")
	gpu, _ := s.Runner.Run(ctx, "nvidia-smi.exe", "--query-gpu=uuid,memory.total,memory.free,utilization.gpu", "--format=csv,noheader,nounits")
	return map[string]any{"checkLevel": "light", "healthy": true, "providerBusy": false, "memory": memory, "gpu": gpu, "checkedAt": time.Now().UTC().Format(time.RFC3339)}, nil
}

func windowsNestedMap(value any) map[string]any { result, _ := value.(map[string]any); return result }

func (s Server) wslLeaseLockPath() string { return filepath.Join(s.DataDir, "leases", "active.json") }

func windowsLeaseDistro(leaseID string) (string, error) {
	if !windowsSafeID.MatchString(leaseID) {
		return "", fmt.Errorf("invalid leaseId")
	}
	return "Exora-Lease-" + leaseID, nil
}

func (s Server) leaseRecheck(ctx context.Context, input map[string]any) (map[string]any, error) {
	leaseID := winString(input, "leaseId")
	if _, err := windowsLeaseDistro(leaseID); err != nil {
		return nil, err
	}
	if raw, err := os.ReadFile(s.wslLeaseLockPath()); err == nil {
		var lock map[string]any
		_ = json.Unmarshal(raw, &lock)
		if current, _ := lock["leaseId"].(string); current != "" && current != leaseID {
			return nil, fmt.Errorf("Windows WSL host already has an active lease")
		}
	}
	running, _ := s.Runner.Run(ctx, "wsl.exe", "--list", "--running", "--quiet")
	for _, name := range strings.Fields(strings.ReplaceAll(running, "\x00", "")) {
		if !strings.EqualFold(name, "Exora-Lease-"+leaseID) {
			return nil, fmt.Errorf("another WSL workload is running; managed single-lease mode requires an idle WSL subsystem")
		}
	}
	return map[string]any{"healthy": true, "providerBusy": false, "leaseId": leaseID, "checkLevel": "lease_recheck", "runtimeBackend": "wsl2", "isolationClass": "managed_wsl2_shared_host", "checkedAt": time.Now().UTC()}, nil
}

func wslLeasePort(leaseID string) int {
	sum := sha256.Sum256([]byte(leaseID))
	return 22000 + (int(sum[0]) << 4) + int(sum[1])%16
}

func (s Server) provisionLease(ctx context.Context, input map[string]any) (map[string]any, error) {
	if _, err := s.leaseRecheck(ctx, input); err != nil {
		return nil, err
	}
	leaseID := winString(input, "leaseId")
	distro, err := windowsLeaseDistro(leaseID)
	if err != nil {
		return nil, err
	}
	product := windowsNestedMap(input["product"])
	manifest := windowsNestedMap(product["manifest"])
	if isolation, _ := manifest["isolationClass"].(string); isolation != "managed_wsl2_shared_host" {
		return nil, fmt.Errorf("WSL lease requires managed_wsl2_shared_host isolation contract")
	}
	imageID, _ := manifest["environmentImageId"].(string)
	artifact, _ := manifest["artifactPath"].(string)
	if artifact == "" && windowsSafeID.MatchString(imageID) {
		artifact = filepath.Join(s.DataDir, "images", imageID+".wsl")
	}
	artifactAbs, err := filepath.Abs(artifact)
	if err != nil {
		return nil, err
	}
	imagesRoot, _ := filepath.Abs(filepath.Join(s.DataDir, "images"))
	if !pathWithin(imagesRoot, artifactAbs) || strings.ToLower(filepath.Ext(artifactAbs)) != ".wsl" {
		return nil, fmt.Errorf("lease artifact must be a managed .wsl image")
	}
	if _, err := os.Stat(artifactAbs); err != nil {
		return nil, fmt.Errorf("lease image is unavailable: %w", err)
	}
	runtimeRoot := filepath.Join(s.DataDir, "lease-runtime")
	if configured, _ := manifest["environmentRoot"].(string); strings.TrimSpace(configured) != "" {
		runtimeRoot = configured
	}
	runtimeRoot, err = filepath.Abs(runtimeRoot)
	if err != nil {
		return nil, err
	}
	if pathWithin(imagesRoot, runtimeRoot) || pathWithin(runtimeRoot, imagesRoot) {
		return nil, fmt.Errorf("lease runtime must be separate from image cache")
	}
	installPath := filepath.Join(runtimeRoot, "leases", leaseID)
	if err := os.MkdirAll(installPath, 0700); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "wsl.exe", "--import", distro, installPath, artifactAbs, "--version", "2"); err != nil {
		_ = os.RemoveAll(installPath)
		return nil, err
	}
	conf, err := s.Runner.Run(ctx, "wsl.exe", "-d", distro, "--exec", "cat", "/etc/wsl.conf")
	if err != nil || !strings.Contains(conf, "enabled=false") || !strings.Contains(conf, "mountFsTab=false") || !strings.Contains(conf, "appendWindowsPath=false") {
		_, _ = s.Runner.Run(ctx, "wsl.exe", "--unregister", distro)
		return nil, fmt.Errorf("lease image permits Windows automount or interop")
	}
	privateKeyPath := filepath.Join(runtimeRoot, "leases", leaseID+".ssh")
	sshPublicKey := winString(input, "sshPublicKey")
	privateKey := ""
	if sshPublicKey == "" {
		if _, err := s.Runner.Run(ctx, "ssh-keygen.exe", "-q", "-t", "ed25519", "-N", "", "-f", privateKeyPath); err != nil {
			return nil, err
		}
		publicRaw, readErr := os.ReadFile(privateKeyPath + ".pub")
		if readErr != nil {
			return nil, readErr
		}
		sshPublicKey = strings.TrimSpace(string(publicRaw))
		privateRaw, readErr := os.ReadFile(privateKeyPath)
		if readErr != nil {
			return nil, readErr
		}
		privateKey = string(privateRaw)
	}
	encodedPublic := base64.StdEncoding.EncodeToString([]byte(sshPublicKey + "\n"))
	setupCommand := "umask 077; mkdir -p /root/.ssh; echo " + encodedPublic + " | base64 -d > /root/.ssh/authorized_keys; chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys; ssh-keygen -A; /usr/sbin/sshd"
	if _, err := s.Runner.Run(ctx, "wsl.exe", "-d", distro, "--user", "root", "--exec", "sh", "-lc", setupCommand); err != nil {
		return nil, fmt.Errorf("WSL guest bootstrap failed: %w", err)
	}
	ipRaw, err := s.Runner.Run(ctx, "wsl.exe", "-d", distro, "--exec", "hostname", "-I")
	if err != nil {
		return nil, fmt.Errorf("WSL guest verification failed: %w", err)
	}
	guestIP := strings.Fields(ipRaw)
	if len(guestIP) == 0 {
		return nil, fmt.Errorf("WSL guest did not report an address")
	}
	port := wslLeasePort(leaseID)
	if _, err := s.Runner.Run(ctx, "netsh.exe", "interface", "portproxy", "add", "v4tov4", "listenaddress=0.0.0.0", "listenport="+strconv.Itoa(port), "connectaddress="+guestIP[0], "connectport=22"); err != nil {
		return nil, err
	}
	firewallRule := "Exora Lease " + leaseID
	if _, err := s.Runner.Run(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "New-NetFirewallRule -DisplayName '"+firewallRule+"' -Direction Inbound -Action Allow -Protocol TCP -LocalPort "+strconv.Itoa(port)+" -Profile Private | Out-Null"); err != nil {
		return nil, err
	}
	publicHost, _ := manifest["publicHost"].(string)
	if strings.TrimSpace(publicHost) == "" {
		publicHost = "127.0.0.1"
	}
	metadata := map[string]any{"leaseId": leaseID, "distro": distro, "installPath": installPath, "port": port, "firewallRule": firewallRule}
	raw, _ := json.Marshal(metadata)
	if err := os.MkdirAll(filepath.Dir(s.wslLeaseLockPath()), 0700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(s.wslLeaseLockPath(), raw, 0600); err != nil {
		return nil, err
	}
	_ = os.Remove(privateKeyPath)
	_ = os.Remove(privateKeyPath + ".pub")
	capability := map[string]any{"protocol": "ssh", "host": publicHost, "port": port, "username": "root", "leaseEpoch": winInt64(input, "leaseEpoch")}
	if privateKey != "" {
		capability["privateKeyPem"] = privateKey
	}
	return map[string]any{"leaseId": leaseID, "state": "active", "guestVerified": true, "backend": "wsl2", "isolationClass": "managed_wsl2_shared_host", "resourceDisclosure": map[string]any{"singleLeasePerHost": true, "cpuMemoryAreConfiguredCaps": true, "gpuSharedWindowsDriver": true, "hardwarePassthroughExclusive": false}, "capability": capability}, nil
}

func (s Server) renewLease(ctx context.Context, input map[string]any) (map[string]any, error) {
	leaseID := winString(input, "leaseId")
	if _, err := s.leaseRecheck(ctx, input); err != nil {
		return nil, fmt.Errorf("WSL isolation conditions no longer hold: %w", err)
	}
	distro, err := windowsLeaseDistro(leaseID)
	if err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "wsl.exe", "-d", distro, "--exec", "true"); err != nil {
		return nil, fmt.Errorf("WSL lease guest is not running")
	}
	return map[string]any{"leaseId": leaseID, "leaseEpoch": winInt64(input, "leaseEpoch"), "state": "active", "renewedAt": time.Now().UTC()}, nil
}

func (s Server) resetLease(ctx context.Context, input map[string]any) (map[string]any, error) {
	leaseID := winString(input, "leaseId")
	distro, err := windowsLeaseDistro(leaseID)
	if err != nil {
		return nil, err
	}
	metadata := map[string]any{}
	if raw, readErr := os.ReadFile(s.wslLeaseLockPath()); readErr == nil {
		_ = json.Unmarshal(raw, &metadata)
		if current, _ := metadata["leaseId"].(string); current != "" && current != leaseID {
			return nil, fmt.Errorf("active WSL lease lock belongs to another lease")
		}
	}
	port := int(winInt64(metadata, "port"))
	if port > 0 {
		_, _ = s.Runner.Run(ctx, "netsh.exe", "interface", "portproxy", "delete", "v4tov4", "listenaddress=0.0.0.0", "listenport="+strconv.Itoa(port))
	}
	if rule, _ := metadata["firewallRule"].(string); rule != "" {
		_, _ = s.Runner.Run(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Remove-NetFirewallRule -DisplayName '"+rule+"' -ErrorAction SilentlyContinue")
	}
	_, _ = s.Runner.Run(ctx, "wsl.exe", "--terminate", distro)
	if _, err := s.Runner.Run(ctx, "wsl.exe", "--unregister", distro); err != nil {
		return nil, err
	}
	if path, _ := metadata["installPath"].(string); path != "" {
		_ = os.RemoveAll(path)
	}
	_ = os.Remove(s.wslLeaseLockPath())
	return map[string]any{"leaseId": leaseID, "state": "verified", "resetReceipt": map[string]any{"distributionUnregistered": true, "guestCredentialsDestroyed": true, "portProxyRemoved": true, "completedAt": time.Now().UTC()}}, nil
}

func decodeWindowsOutput(raw []byte) string {
	if len(raw) >= 2 && raw[1] == 0 {
		words := make([]uint16, 0, len(raw)/2)
		for i := 0; i+1 < len(raw); i += 2 {
			words = append(words, uint16(raw[i])|uint16(raw[i+1])<<8)
		}
		return string(utf16.Decode(words))
	}
	return string(raw)
}
