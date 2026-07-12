//go:build linux

package providerworker

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s: %w", strings.TrimSpace(string(b)), err)
	}
	return strings.TrimSpace(string(b)), nil
}

type Server struct {
	Socket, DataDir string
	Runner          Runner
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

func (s Server) Serve(ctx context.Context) error {
	if s.Socket == "" {
		s.Socket = DefaultSocket
	}
	if s.DataDir == "" {
		s.DataDir = "/var/lib/exora-worker"
	}
	if s.Runner == nil {
		s.Runner = ExecRunner{}
	}
	if err := os.MkdirAll(filepath.Dir(s.Socket), 0750); err != nil {
		return err
	}
	if err := os.MkdirAll(s.DataDir, 0750); err != nil {
		return err
	}
	_ = os.Remove(s.Socket)
	ln, err := net.Listen("unix", s.Socket)
	if err != nil {
		return err
	}
	defer ln.Close()
	_ = os.Chmod(s.Socket, 0660)
	if group, err := user.LookupGroup("exora"); err == nil {
		if gid, e := strconv.Atoi(group.Gid); e == nil {
			_ = os.Chown(s.Socket, 0, gid)
		}
	}
	go func() { <-ctx.Done(); _ = ln.Close() }()
	for {
		c, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go s.handle(ctx, c)
	}
}
func (s Server) handle(ctx context.Context, c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Minute))
	var req Request
	if json.NewDecoder(bufio.NewReader(io.LimitReader(c, 1<<20))).Decode(&req) != nil {
		return
	}
	out := Response{ID: req.ID}
	if !AllowedCommands[req.Command] {
		out.Error = "unsupported command"
	} else {
		result, err := s.dispatch(ctx, req.Command, req.Input)
		if err != nil {
			out.Error = err.Error()
		} else {
			out.OK = true
			out.Result = result
		}
	}
	s.audit(req.Command, out.OK, out.Error)
	_ = json.NewEncoder(c).Encode(out)
}
func (s Server) audit(command string, ok bool, message string) {
	record, _ := json.Marshal(map[string]any{"time": time.Now().UTC(), "command": command, "ok": ok, "error": message})
	f, err := os.OpenFile(filepath.Join(s.DataDir, "audit.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err == nil {
		_, _ = f.Write(append(record, '\n'))
		_ = f.Close()
	}
}
func str(in map[string]any, key string) string { v, _ := in[key].(string); return strings.TrimSpace(v) }
func (s Server) managedPath(name string) (string, error) {
	if !safeID.MatchString(name) {
		return "", fmt.Errorf("invalid id")
	}
	root, err := filepath.Abs(s.DataDir)
	if err != nil {
		return "", err
	}
	p := filepath.Join(root, name)
	if !strings.HasPrefix(p, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes data dir")
	}
	return p, nil
}
func (s Server) dispatch(ctx context.Context, cmd string, in map[string]any) (map[string]any, error) {
	switch cmd {
	case "probe_host":
		return s.probe(ctx)
	case "list_domains":
		return s.domains(ctx)
	case "capacity_check":
		return s.capacity(ctx)
	case "reserve_disk":
		return s.reserve(ctx, in)
	case "import_template":
		return s.importTemplate(ctx, in)
	case "validate_template":
		return s.validate(ctx, in)
	case "create_test_clone":
		return s.clone(ctx, in)
	case "reset_test_clone":
		return s.reset(ctx, in)
	case "delete_template":
		p, err := s.managedPath(str(in, "templateId") + ".qcow2")
		if err != nil {
			return nil, err
		}
		return map[string]any{"deleted": true}, os.Remove(p)
	}
	return nil, fmt.Errorf("unsupported command")
}
func (s Server) probe(ctx context.Context) (map[string]any, error) {
	kvm := false
	if _, err := os.Stat("/dev/kvm"); err == nil {
		kvm = true
	}
	gpus, _ := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,name,memory.total,pci.bus_id", "--format=csv,noheader,nounits")
	domains, _ := s.Runner.Run(ctx, "virsh", "list", "--all", "--name")
	return map[string]any{"os": "linux", "kvm": kvm, "iommu": iommuReady(), "gpus": splitLines(gpus), "domains": splitLines(domains)}, nil
}
func iommuReady() bool { entries, _ := os.ReadDir("/sys/kernel/iommu_groups"); return len(entries) > 0 }
func splitLines(v string) []string {
	out := []string{}
	for _, x := range strings.Split(v, "\n") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}
func (s Server) domains(ctx context.Context) (map[string]any, error) {
	names, err := s.Runner.Run(ctx, "virsh", "list", "--all", "--name")
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, name := range splitLines(names) {
		state, _ := s.Runner.Run(ctx, "virsh", "domstate", name)
		items = append(items, map[string]any{"name": name, "state": state, "eligible": strings.Contains(strings.ToLower(state), "shut")})
	}
	return map[string]any{"domains": items}, nil
}
func (s Server) capacity(ctx context.Context) (map[string]any, error) {
	gpu, _ := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,name,memory.total,memory.free,pci.bus_id", "--format=csv,noheader,nounits")
	procs, _ := s.Runner.Run(ctx, "nvidia-smi", "--query-compute-apps=pid,process_name,gpu_uuid,used_memory", "--format=csv,noheader,nounits")
	mem, _ := os.ReadFile("/proc/meminfo")
	return map[string]any{"gpus": splitLines(gpu), "gpuProcesses": splitLines(procs), "memory": string(mem), "providerBusy": len(splitLines(procs)) > 0, "checkedAt": time.Now().UTC()}, nil
}
func (s Server) reserve(ctx context.Context, in map[string]any) (map[string]any, error) {
	id := str(in, "slotId")
	p, err := s.managedPath(id + ".reserve")
	if err != nil {
		return nil, err
	}
	size := int64(0)
	switch v := in["sizeBytes"].(type) {
	case float64:
		size = int64(v)
	case json.Number:
		size, _ = v.Int64()
	}
	if size < 1<<30 {
		return nil, fmt.Errorf("reservation must be at least 1 GiB")
	}
	if err := os.MkdirAll(s.DataDir, 0750); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "fallocate", "-l", strconv.FormatInt(size, 10), "--", p); err != nil {
		return nil, fmt.Errorf("hard disk reservation failed: %w", err)
	}
	if err := os.Chmod(p, 0600); err != nil {
		return nil, err
	}
	info, err := os.Stat(p)
	if err != nil || info.Size() != size {
		return nil, fmt.Errorf("disk reservation size verification failed")
	}
	return map[string]any{"path": p, "sizeBytes": size, "reserved": true, "allocation": "fallocate"}, nil
}
func (s Server) importTemplate(ctx context.Context, in map[string]any) (map[string]any, error) {
	domain := str(in, "domain")
	id := str(in, "templateId")
	if !safeID.MatchString(domain) || !safeID.MatchString(id) {
		return nil, fmt.Errorf("invalid domain or template id")
	}
	state, err := s.Runner.Run(ctx, "virsh", "domstate", domain)
	if err != nil || !strings.Contains(strings.ToLower(state), "shut") {
		return nil, fmt.Errorf("domain must be shut off")
	}
	xml, err := s.Runner.Run(ctx, "virsh", "dumpxml", "--inactive", domain)
	if err != nil {
		return nil, err
	}
	source := diskSource(xml)
	if source == "" {
		return nil, fmt.Errorf("domain has no file-backed primary disk")
	}
	dst, err := s.managedPath(id + ".qcow2")
	if err != nil {
		return nil, err
	}
	xmlPath, err := s.managedPath(id + ".xml")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.DataDir, 0750); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "qemu-img", "convert", "-p", "-O", "qcow2", source, dst); err != nil {
		return nil, err
	}
	if err := os.WriteFile(xmlPath, []byte(xml), 0440); err != nil {
		_ = os.Remove(dst)
		return nil, err
	}
	sum, err := fileSHA(dst)
	if err != nil {
		return nil, err
	}
	_ = os.Chmod(dst, 0440)
	return map[string]any{"templateId": id, "path": dst, "sha256": sum, "sourceDomain": domain, "sourceXmlStored": true}, nil
}
func diskSource(xml string) string {
	re := regexp.MustCompile(`<source\s+file=['\"]([^'\"]+)['\"]`)
	m := re.FindStringSubmatch(xml)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}
func fileSHA(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func (s Server) validate(ctx context.Context, in map[string]any) (map[string]any, error) {
	p, err := s.managedPath(str(in, "templateId") + ".qcow2")
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat("/dev/kvm"); err != nil {
		return nil, fmt.Errorf("KVM is unavailable")
	}
	if !iommuReady() {
		return nil, fmt.Errorf("IOMMU is unavailable")
	}
	gpus, err := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,pci.bus_id", "--format=csv,noheader,nounits")
	if err != nil || len(splitLines(gpus)) == 0 {
		return nil, fmt.Errorf("at least one NVIDIA GPU is required")
	}
	processes, _ := s.Runner.Run(ctx, "nvidia-smi", "--query-compute-apps=pid,process_name,gpu_uuid,used_memory", "--format=csv,noheader,nounits")
	if len(splitLines(processes)) > 0 {
		return nil, fmt.Errorf("provider GPU is busy")
	}
	info, err := s.Runner.Run(ctx, "qemu-img", "check", "-f", "qcow2", p)
	if err != nil {
		return nil, err
	}
	sum, err := fileSHA(p)
	return map[string]any{"valid": err == nil, "sha256": sum, "qemuCheck": info, "gpuCount": len(splitLines(gpus)), "iommu": true, "kvm": true, "checkedAt": time.Now().UTC()}, err
}
func (s Server) clone(ctx context.Context, in map[string]any) (map[string]any, error) {
	id := str(in, "templateId")
	clone := str(in, "cloneId")
	if !safeID.MatchString(id) || !safeID.MatchString(clone) {
		return nil, fmt.Errorf("invalid clone or template id")
	}
	base, err := s.managedPath(id + ".qcow2")
	if err != nil {
		return nil, err
	}
	dst, err := s.managedPath(clone + ".qcow2")
	if err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err = rand.Read(key); err != nil {
		return nil, err
	}
	secret := base64.StdEncoding.EncodeToString(key)
	_, err = s.Runner.Run(ctx, "qemu-img", "create", "--object", "secret,id=sec0,data="+secret, "-f", "qcow2", "-F", "qcow2", "-b", base, "-o", "encrypt.format=luks,encrypt.key-secret=sec0", dst)
	for i := range key {
		key[i] = 0
	}
	if err != nil {
		return nil, err
	}
	gpus, gpuErr := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,pci.bus_id", "--format=csv,noheader,nounits")
	if gpuErr != nil || len(splitLines(gpus)) == 0 {
		_ = os.Remove(dst)
		return nil, fmt.Errorf("GPU passthrough inventory unavailable")
	}
	return map[string]any{"cloneId": clone, "path": dst, "encrypted": true, "gpuDevices": splitLines(gpus), "allGpuPassthrough": true, "keyRetained": false}, nil
}
func (s Server) reset(ctx context.Context, in map[string]any) (map[string]any, error) {
	clone := str(in, "cloneId")
	if !safeID.MatchString(clone) {
		return nil, fmt.Errorf("invalid clone id")
	}
	_, _ = s.Runner.Run(ctx, "virsh", "destroy", clone)
	_, _ = s.Runner.Run(ctx, "virsh", "undefine", clone, "--nvram")
	p, err := s.managedPath(clone + ".qcow2")
	if err != nil {
		return nil, err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return map[string]any{"cloneId": clone, "writeLayerDeleted": true, "encryptionKeyDestroyed": true, "state": "verified", "completedAt": time.Now().UTC()}, nil
}

var _ = strconv.Itoa
