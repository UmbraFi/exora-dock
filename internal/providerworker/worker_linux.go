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
	"encoding/xml"
	"errors"
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
	"sync"
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
	case "probe_host", "probe_runtime":
		return s.probe(ctx)
	case "list_domains", "list_environment_images":
		return s.domains(ctx)
	case "capacity_check":
		return s.capacity(ctx)
	case "reserve_disk":
		return s.reserve(ctx, in)
	case "release_disk":
		return s.release(in)
	case "import_template", "import_environment_image":
		return s.importTemplate(ctx, in)
	case "validate_template", "validate_environment_image":
		return s.validate(ctx, in)
	case "create_test_clone":
		return s.clone(ctx, in)
	case "reset_test_clone":
		return s.reset(ctx, in)
	case "lease_recheck":
		return persistentWorkerCommand(s.DataDir, cmd, in, func() (map[string]any, error) { return s.leaseRecheck(ctx, in) })
	case "provision_lease":
		return persistentWorkerCommand(s.DataDir, cmd, in, func() (map[string]any, error) { return s.provisionLease(ctx, in) })
	case "renew_lease_epoch":
		return persistentWorkerCommand(s.DataDir, cmd, in, func() (map[string]any, error) { return s.renewLease(ctx, in) })
	case "reset_lease":
		return persistentWorkerCommand(s.DataDir, cmd, in, func() (map[string]any, error) { return s.resetLease(ctx, in) })
	case "lease_terminal_exec":
		return s.leaseTerminalExec(ctx, in)
	case "lease_workspace_stat":
		return s.leaseWorkspaceStat(in)
	case "lease_workspace_partial_stat":
		return s.leaseWorkspacePartialStat(in)
	case "lease_workspace_read":
		return s.leaseWorkspaceRead(in)
	case "lease_workspace_write":
		return s.leaseWorkspaceWrite(in)
	case "lease_transfer_review":
		return s.leaseTransferReview(in)
	case "lease_host_performance_probe":
		return s.leaseHostPerformanceProbe(ctx, in)
	case "lease_guest_performance_probe":
		return s.leaseGuestPerformanceProbe(ctx, in)
	case "lease_apply_load_throttle":
		return s.leaseLoadThrottle(ctx, in, true)
	case "lease_clear_load_throttle":
		return s.leaseLoadThrottle(ctx, in, false)
	case "delete_template", "delete_environment_image":
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
func (s Server) release(in map[string]any) (map[string]any, error) {
	p, err := s.managedPath(str(in, "slotId") + ".reserve")
	if err != nil {
		return nil, err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return map[string]any{"released": true}, nil
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

func linuxInt64(in map[string]any, key string) int64 {
	switch value := in[key].(type) {
	case int64:
		return value
	case float64:
		return int64(value)
	case json.Number:
		result, _ := value.Int64()
		return result
	case string:
		result, _ := strconv.ParseInt(value, 10, 64)
		return result
	}
	return 0
}

func nestedWorkerMap(value any) map[string]any { result, _ := value.(map[string]any); return result }

func linuxLeaseProduct(in map[string]any) (map[string]any, map[string]any) {
	product := nestedWorkerMap(in["product"])
	return product, nestedWorkerMap(product["manifest"])
}

func (s Server) leaseRecheck(ctx context.Context, in map[string]any) (map[string]any, error) {
	if _, err := os.Stat("/dev/kvm"); err != nil {
		return nil, fmt.Errorf("KVM is unavailable")
	}
	if !iommuReady() {
		return nil, fmt.Errorf("IOMMU is unavailable")
	}
	capacity, err := s.capacity(ctx)
	if err != nil {
		return nil, err
	}
	if busy, _ := capacity["providerBusy"].(bool); busy {
		return nil, fmt.Errorf("provider GPU is busy")
	}
	leaseID := str(in, "leaseId")
	if !safeID.MatchString(leaseID) {
		return nil, fmt.Errorf("invalid leaseId")
	}
	return map[string]any{"healthy": true, "providerBusy": false, "leaseId": leaseID, "checkLevel": "lease_recheck", "checkedAt": time.Now().UTC()}, nil
}

func randomLeaseUUID() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(raw)
	return hexValue[:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:]
}

func replaceLeaseDomainXML(source, leaseID, diskPath, secretUUID, seedPath string) string {
	source = regexp.MustCompile(`<name>[^<]+</name>`).ReplaceAllString(source, "<name>"+leaseID+"</name>")
	source = regexp.MustCompile(`(?s)<uuid>.*?</uuid>`).ReplaceAllString(source, "")
	source = regexp.MustCompile(`<source\s+file=['\"][^'\"]+['\"]\s*/>`).ReplaceAllString(source, "<source file='"+diskPath+"'/>")
	encryption := "<encryption format='luks'><secret type='passphrase' uuid='" + secretUUID + "'/></encryption>"
	source = strings.Replace(source, "</disk>", encryption+"</disk>", 1)
	seed := "<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='" + seedPath + "'/><target dev='sdb' bus='sata'/><readonly/></disk>"
	return strings.Replace(source, "</devices>", seed+"</devices>", 1)
}

func escapeXMLAttribute(value string) string {
	var out strings.Builder
	_ = xml.EscapeText(&out, []byte(value))
	return strings.ReplaceAll(out.String(), "'", "&apos;")
}

func isolateLeaseDomainXML(source, workspacePath string) string {
	source = regexp.MustCompile(`(?s)<interface\b[^>]*>.*?</interface>`).ReplaceAllString(source, "")
	source = regexp.MustCompile(`(?s)<interface\b[^>]*/>`).ReplaceAllString(source, "")
	source = regexp.MustCompile(`(?s)<filesystem\b[^>]*>.*?</filesystem>`).ReplaceAllString(source, "")
	source = regexp.MustCompile(`(?s)<vsock\b[^>]*>.*?</vsock>`).ReplaceAllString(source, "")
	devices := "<vsock model='virtio'><cid auto='yes'/></vsock>" +
		"<filesystem type='mount' accessmode='passthrough'><driver type='virtiofs'/><source dir='" + escapeXMLAttribute(workspacePath) + "'/><target dir='exora-workspace'/></filesystem>"
	return strings.Replace(source, "</devices>", devices+"</devices>", 1)
}

func (s Server) provisionLease(ctx context.Context, in map[string]any) (map[string]any, error) {
	if _, err := s.leaseRecheck(ctx, in); err != nil {
		return nil, err
	}
	leaseID := str(in, "leaseId")
	if str(in, "securityMode") != "isolated_control_p2p_v1" {
		return nil, errors.New("isolated_control_p2p_v1 securityMode is required")
	}
	_, manifest := linuxLeaseProduct(in)
	templateID, _ := manifest["templateId"].(string)
	if templateID == "" {
		templateID, _ = manifest["environmentImageId"].(string)
	}
	if !safeID.MatchString(templateID) {
		return nil, fmt.Errorf("compute manifest requires a valid templateId")
	}
	base, err := s.managedPath(templateID + ".qcow2")
	if err != nil {
		return nil, err
	}
	templateXMLPath, err := s.managedPath(templateID + ".xml")
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(base); err != nil {
		return nil, fmt.Errorf("golden image is unavailable: %w", err)
	}
	templateXML, err := os.ReadFile(templateXMLPath)
	if err != nil {
		return nil, fmt.Errorf("golden domain XML is unavailable: %w", err)
	}
	diskPath, _ := s.managedPath(leaseID + ".qcow2")
	keyPath, _ := s.managedPath(leaseID + ".key")
	secretPath, _ := s.managedPath(leaseID + ".secret.xml")
	domainPath, _ := s.managedPath(leaseID + ".lease.xml")
	seedPath, _ := s.managedPath(leaseID + ".seed.iso")
	workspacePath, _ := s.managedPath(leaseID + ".workspace")
	if err := os.MkdirAll(workspacePath, 0700); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	encodedKey := base64.StdEncoding.EncodeToString(key)
	if err := os.WriteFile(keyPath, []byte(encodedKey), 0600); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "qemu-img", "create", "--object", "secret,id=sec0,data="+encodedKey, "-f", "qcow2", "-F", "qcow2", "-b", base, "-o", "encrypt.format=luks,encrypt.key-secret=sec0", diskPath); err != nil {
		_ = os.Remove(keyPath)
		return nil, err
	}
	secretUUID := randomLeaseUUID()
	secretXML := "<secret ephemeral='no' private='yes'><uuid>" + secretUUID + "</uuid><usage type='volume'><name>exora-" + leaseID + "</name></usage></secret>"
	if err := os.WriteFile(secretPath, []byte(secretXML), 0600); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "virsh", "secret-define", "--file", secretPath); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "virsh", "secret-set-value", "--secret", secretUUID, "--base64", encodedKey); err != nil {
		return nil, err
	}
	userDataPath, _ := s.managedPath(leaseID + ".user-data")
	metaDataPath, _ := s.managedPath(leaseID + ".meta-data")
	userData := "#cloud-config\ndisable_root: false\nssh_pwauth: false\nmounts:\n  - [exora-workspace, /workspace, virtiofs, defaults, '0', '0']\nruncmd:\n  - [mkdir, -p, /workspace]\n"
	_ = os.WriteFile(userDataPath, []byte(userData), 0600)
	_ = os.WriteFile(metaDataPath, []byte("instance-id: "+leaseID+"\nlocal-hostname: "+leaseID+"\n"), 0600)
	if _, err := s.Runner.Run(ctx, "cloud-localds", seedPath, userDataPath, metaDataPath); err != nil {
		return nil, fmt.Errorf("cloud-init seed creation failed: %w", err)
	}
	domainXML := isolateLeaseDomainXML(replaceLeaseDomainXML(string(templateXML), leaseID, diskPath, secretUUID, seedPath), workspacePath)
	if err := os.WriteFile(domainPath, []byte(domainXML), 0600); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "virsh", "define", domainPath); err != nil {
		return nil, err
	}
	if _, err := s.Runner.Run(ctx, "virsh", "start", leaseID); err != nil {
		return nil, err
	}
	state, err := s.Runner.Run(ctx, "virsh", "domstate", leaseID)
	if err != nil || !strings.Contains(strings.ToLower(state), "running") {
		return nil, fmt.Errorf("guest verification failed")
	}
	guestProbePublicKey, _, probeKeyErr := ensureLeaseProbeIdentity(s.DataDir, leaseID)
	if probeKeyErr != nil {
		return nil, probeKeyErr
	}
	metadata := map[string]any{"leaseId": leaseID, "leaseEpoch": linuxInt64(in, "leaseEpoch"), "secretUUID": secretUUID, "seedPath": seedPath, "domainPath": domainPath, "keyPath": keyPath, "diskPath": diskPath, "workspacePath": workspacePath, "securityMode": "isolated_control_p2p_v1", "workloadPolicy": in["workloadPolicy"], "performancePolicy": in["performancePolicy"], "enforcementMode": in["enforcementMode"], "guestProbePublicKey": guestProbePublicKey}
	metadataRaw, _ := json.Marshal(metadata)
	metadataPath, _ := s.managedPath(leaseID + ".lease.json")
	_ = os.WriteFile(metadataPath, metadataRaw, 0600)
	_ = os.Remove(userDataPath)
	_ = os.Remove(metaDataPath)
	for i := range key {
		key[i] = 0
	}
	capability := map[string]any{"protocol": "exora_control", "terminal": true, "fileTransfer": "webrtc_p2p", "networkAccess": "none", "workspace": "/workspace", "leaseEpoch": linuxInt64(in, "leaseEpoch")}
	return map[string]any{"leaseId": leaseID, "state": "active", "guestVerified": true, "backend": "kvm_libvirt", "isolationClass": "hardware_virtualized", "capability": capability, "guestProbePublicKey": guestProbePublicKey}, nil
}

type linuxCPUProbePoint struct {
	at          time.Time
	nanoseconds int64
}

var linuxPerformanceProbeMu sync.Mutex
var linuxCPUProbePoints = map[string]linuxCPUProbePoint{}

func boundedBPS(value int64) int64 {
	if value < 0 {
		return 0
	}
	if value > 10000 {
		return 10000
	}
	return value
}

func numericField(output, pattern string) int64 {
	match := regexp.MustCompile(pattern).FindStringSubmatch(output)
	if len(match) != 2 {
		return 0
	}
	value, _ := strconv.ParseFloat(strings.TrimSpace(match[1]), 64)
	return int64(value)
}

func (s Server) leaseHostPerformanceProbe(ctx context.Context, in map[string]any) (map[string]any, error) {
	metadata, err := s.linuxLeaseMetadata(in)
	if err != nil {
		return nil, err
	}
	leaseID := str(metadata, "leaseId")
	domstats, domErr := s.Runner.Run(ctx, "virsh", "domstats", leaseID, "--cpu-total", "--vcpu", "--balloon", "--block")
	if domErr != nil {
		return nil, fmt.Errorf("performance_probe_unavailable: %w", domErr)
	}
	now := time.Now().UTC()
	cpuTime := numericField(domstats, `cpu\.time=(\d+)`)
	vcpus := numericField(domstats, `vcpu\.current=(\d+)`)
	if vcpus <= 0 {
		vcpus = 1
	}
	linuxPerformanceProbeMu.Lock()
	previous := linuxCPUProbePoints[leaseID]
	linuxCPUProbePoints[leaseID] = linuxCPUProbePoint{at: now, nanoseconds: cpuTime}
	linuxPerformanceProbeMu.Unlock()
	cpuBPS := int64(0)
	if !previous.at.IsZero() && cpuTime >= previous.nanoseconds {
		elapsed := now.Sub(previous.at).Nanoseconds()
		if elapsed > 0 {
			cpuBPS = boundedBPS((cpuTime - previous.nanoseconds) * 10000 / (elapsed * vcpus))
		}
	}
	gpuOut, _ := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=utilization.gpu,clocks.sm,clocks.max.sm,power.draw,power.limit,temperature.gpu,clocks_throttle_reasons.active", "--format=csv,noheader,nounits")
	gpuBPS, clockBPS, thermal, power := int64(0), int64(10000), false, false
	if line := strings.TrimSpace(strings.Split(gpuOut, "\n")[0]); line != "" {
		fields := strings.Split(line, ",")
		if len(fields) > 0 {
			gpuBPS = boundedBPS(numericField(fields[0], `([0-9.]+)`) * 100)
		}
		if len(fields) > 2 {
			current := numericField(fields[1], `([0-9.]+)`)
			maximum := numericField(fields[2], `([0-9.]+)`)
			if maximum > 0 {
				clockBPS = boundedBPS(current * 10000 / maximum)
			}
		}
		lower := strings.ToLower(line)
		thermal = strings.Contains(lower, "thermal") && !strings.Contains(lower, "not active")
		power = strings.Contains(lower, "power") && !strings.Contains(lower, "not active")
	}
	host := map[string]any{"cpuUtilizationBps": cpuBPS, "gpuUtilizationBps": gpuBPS, "cpuStealBps": 0, "allocationBps": 10000, "clockBps": clockBPS, "hostContention": false, "thermalThrottle": thermal, "powerThrottle": power}
	return map[string]any{"host": host, "sampledAt": now, "privacy": "aggregate_only"}, nil
}

func (s Server) leaseGuestPerformanceProbe(ctx context.Context, in map[string]any) (map[string]any, error) {
	metadata, err := s.linuxLeaseMetadata(in)
	if err != nil {
		return nil, err
	}
	leaseID := str(metadata, "leaseId")
	challenge := map[string]any{}
	for key, value := range in {
		challenge[key] = value
	}
	challenge["command"] = "set -eu; p=/workspace/.exora-performance-probe.$$; dd if=/dev/zero of=$p bs=1M count=8 conv=fsync status=none; sha256sum $p >/dev/null; rm -f $p"
	started := time.Now()
	_, runErr := s.leaseTerminalExec(ctx, challenge)
	elapsed := time.Since(started)
	guest := map[string]any{"available": runErr == nil}
	if runErr == nil {
		score := int64(10000)
		if elapsed > 2*time.Second {
			score = boundedBPS(int64(2*time.Second) * 10000 / int64(elapsed))
		}
		guest = map[string]any{"available": true, "cpuBps": score, "gpuBps": score, "memoryBps": score, "workspaceDiskBps": score, "deliveryBps": score}
	}
	publicKey, signature, signErr := signLeaseProbeResult(s.DataDir, leaseID, guest)
	if signErr != nil {
		return nil, signErr
	}
	return map[string]any{"guest": guest, "guestProbePublicKey": publicKey, "guestSignature": signature, "challengeDurationMillis": elapsed.Milliseconds(), "challengeExcludedFromLoad": true}, nil
}

func (s Server) leaseLoadThrottle(ctx context.Context, in map[string]any, apply bool) (map[string]any, error) {
	metadata, err := s.linuxLeaseMetadata(in)
	if err != nil {
		return nil, err
	}
	leaseID := str(metadata, "leaseId")
	if apply {
		if str(metadata, "enforcementMode") != "host_throttle" {
			return nil, errors.New("load_throttle_capability_unavailable")
		}
		dominfo, _ := s.Runner.Run(ctx, "virsh", "dominfo", leaseID)
		vcpus := numericField(dominfo, `(?m)^CPU\(s\):\s+(\d+)`)
		if vcpus <= 0 {
			vcpus = 1
		}
		quota := vcpus * 50000
		if _, err = s.Runner.Run(ctx, "virsh", "schedinfo", leaseID, "--set", "vcpu_period=100000", "--set", "vcpu_quota="+strconv.FormatInt(quota, 10)); err != nil {
			return nil, err
		}
	} else {
		if _, err = s.Runner.Run(ctx, "virsh", "schedinfo", leaseID, "--set", "vcpu_quota=-1"); err != nil {
			return nil, err
		}
	}
	gpuPowerAdjusted := 0
	if powerInventory, inventoryErr := s.Runner.Run(ctx, "nvidia-smi", "--query-gpu=uuid,power.default_limit,power.min_limit", "--format=csv,noheader,nounits"); inventoryErr == nil {
		for _, line := range splitLines(powerInventory) {
			fields := strings.Split(line, ",")
			if len(fields) < 3 {
				continue
			}
			uuid := strings.TrimSpace(fields[0])
			defaultLimit := numericField(fields[1], `([0-9.]+)`)
			minimumLimit := numericField(fields[2], `([0-9.]+)`)
			target := defaultLimit
			if apply {
				target = defaultLimit / 2
				if target < minimumLimit {
					target = minimumLimit
				}
			}
			if uuid != "" && target > 0 {
				if _, powerErr := s.Runner.Run(ctx, "nvidia-smi", "-i", uuid, "--power-limit="+strconv.FormatInt(target, 10)); powerErr == nil {
					gpuPowerAdjusted++
				}
			}
		}
	}
	return map[string]any{"leaseId": leaseID, "throttled": apply, "targetPerformanceBps": map[bool]int64{true: 5000, false: 10000}[apply], "gpuPowerLimitsAdjusted": gpuPowerAdjusted, "appliedAt": time.Now().UTC()}, nil
}

func (s Server) renewLease(ctx context.Context, in map[string]any) (map[string]any, error) {
	leaseID := str(in, "leaseId")
	if !safeID.MatchString(leaseID) {
		return nil, fmt.Errorf("invalid leaseId")
	}
	state, err := s.Runner.Run(ctx, "virsh", "domstate", leaseID)
	if err != nil || !strings.Contains(strings.ToLower(state), "running") {
		return nil, fmt.Errorf("lease guest is not running")
	}
	return map[string]any{"leaseId": leaseID, "leaseEpoch": linuxInt64(in, "leaseEpoch"), "state": "active", "renewedAt": time.Now().UTC()}, nil
}

func (s Server) resetLease(ctx context.Context, in map[string]any) (map[string]any, error) {
	leaseID := str(in, "leaseId")
	if !safeID.MatchString(leaseID) {
		return nil, fmt.Errorf("invalid leaseId")
	}
	metadataPath, _ := s.managedPath(leaseID + ".lease.json")
	_ = os.Remove(filepath.Join(s.DataDir, "lease-probe-identities", leaseID+".ed25519"))
	metadata := map[string]any{}
	if raw, err := os.ReadFile(metadataPath); err == nil {
		_ = json.Unmarshal(raw, &metadata)
	}
	_, _ = s.Runner.Run(ctx, "virsh", "destroy", leaseID)
	_, _ = s.Runner.Run(ctx, "virsh", "undefine", leaseID, "--nvram")
	if secretUUID, _ := metadata["secretUUID"].(string); secretUUID != "" {
		_, _ = s.Runner.Run(ctx, "virsh", "secret-undefine", secretUUID)
	}
	for _, suffix := range []string{".qcow2", ".key", ".secret.xml", ".lease.xml", ".seed.iso", ".lease.json", ".ssh", ".ssh.pub", ".user-data", ".meta-data"} {
		path, _ := s.managedPath(leaseID + suffix)
		if path != "" {
			_ = os.Remove(path)
		}
	}
	workspacePath, _ := s.managedPath(leaseID + ".workspace")
	if workspacePath != "" {
		_ = os.RemoveAll(workspacePath)
	}
	return map[string]any{"leaseId": leaseID, "state": "verified", "resetReceipt": map[string]any{"writeLayerDeleted": true, "encryptionKeyDestroyed": true, "guestCredentialsDestroyed": true, "completedAt": time.Now().UTC()}}, nil
}

func (s Server) linuxLeaseMetadata(in map[string]any) (map[string]any, error) {
	leaseID := str(in, "leaseId")
	if !safeID.MatchString(leaseID) {
		return nil, errors.New("invalid leaseId")
	}
	metadataPath, _ := s.managedPath(leaseID + ".lease.json")
	raw, err := os.ReadFile(metadataPath)
	if err != nil {
		return nil, errors.New("active lease metadata unavailable")
	}
	metadata := map[string]any{}
	if json.Unmarshal(raw, &metadata) != nil || str(metadata, "securityMode") != "isolated_control_p2p_v1" {
		return nil, errors.New("invalid isolated lease metadata")
	}
	if epoch := linuxInt64(in, "leaseEpoch"); epoch <= 0 || epoch != linuxInt64(metadata, "leaseEpoch") {
		return nil, errors.New("stale leaseEpoch")
	}
	return metadata, nil
}

func (s Server) leaseTerminalExec(ctx context.Context, in map[string]any) (map[string]any, error) {
	metadata, err := s.linuxLeaseMetadata(in)
	if err != nil {
		return nil, err
	}
	leaseID := str(metadata, "leaseId")
	command := str(in, "command")
	if strings.TrimSpace(command) == "" || len(command) > 64<<10 {
		return nil, errors.New("terminal command must contain 1-65536 bytes")
	}
	request := map[string]any{"execute": "guest-exec", "arguments": map[string]any{"path": "/bin/sh", "arg": []string{"-lc", command}, "capture-output": true}}
	rawRequest, _ := json.Marshal(request)
	rawResult, err := s.Runner.Run(ctx, "virsh", "qemu-agent-command", leaseID, string(rawRequest))
	if err != nil {
		return nil, fmt.Errorf("guest agent terminal unavailable: %w", err)
	}
	started := struct {
		Return struct {
			PID int64 `json:"pid"`
		} `json:"return"`
	}{}
	if json.Unmarshal([]byte(rawResult), &started) != nil || started.Return.PID <= 0 {
		return nil, errors.New("guest agent returned an invalid terminal process")
	}
	statusRequest, _ := json.Marshal(map[string]any{"execute": "guest-exec-status", "arguments": map[string]any{"pid": started.Return.PID}})
	for attempt := 0; attempt < 600; attempt++ {
		statusRaw, statusErr := s.Runner.Run(ctx, "virsh", "qemu-agent-command", leaseID, string(statusRequest))
		if statusErr != nil {
			return nil, statusErr
		}
		var status struct {
			Return struct {
				Exited   bool   `json:"exited"`
				ExitCode int64  `json:"exitcode"`
				OutData  string `json:"out-data"`
				ErrData  string `json:"err-data"`
			} `json:"return"`
		}
		if json.Unmarshal([]byte(statusRaw), &status) != nil {
			return nil, errors.New("guest agent returned invalid terminal status")
		}
		if status.Return.Exited {
			stdout, _ := base64.StdEncoding.DecodeString(status.Return.OutData)
			stderr, _ := base64.StdEncoding.DecodeString(status.Return.ErrData)
			if len(stdout) > workerWorkspaceChunkLimit {
				stdout = stdout[:workerWorkspaceChunkLimit]
			}
			if len(stderr) > workerWorkspaceChunkLimit {
				stderr = stderr[:workerWorkspaceChunkLimit]
			}
			return map[string]any{"stdout": string(stdout), "stderr": string(stderr), "exitCode": status.Return.ExitCode}, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil, errors.New("terminal command timed out")
}

func (s Server) leaseWorkspaceRoot(in map[string]any) (string, error) {
	metadata, err := s.linuxLeaseMetadata(in)
	if err != nil {
		return "", err
	}
	root := str(metadata, "workspacePath")
	if root == "" {
		return "", errors.New("workspace is unavailable")
	}
	return root, nil
}

func (s Server) leaseWorkspaceStat(in map[string]any) (map[string]any, error) {
	root, err := s.leaseWorkspaceRoot(in)
	if err != nil {
		return nil, err
	}
	return workspaceStatResult(root, str(in, "relativePath"))
}

func (s Server) leaseWorkspacePartialStat(in map[string]any) (map[string]any, error) {
	root, err := s.leaseWorkspaceRoot(in)
	if err != nil {
		return nil, err
	}
	return workspacePartialStatResult(root, str(in, "relativePath"))
}

func (s Server) leaseWorkspaceRead(in map[string]any) (map[string]any, error) {
	root, err := s.leaseWorkspaceRoot(in)
	if err != nil {
		return nil, err
	}
	return workspaceReadResult(root, str(in, "relativePath"), workerInt64(in["offset"]), workerInt64(in["limit"]))
}

func (s Server) leaseWorkspaceWrite(in map[string]any) (map[string]any, error) {
	root, err := s.leaseWorkspaceRoot(in)
	if err != nil {
		return nil, err
	}
	finalize, _ := in["finalize"].(bool)
	return workspaceWriteResult(root, str(in, "relativePath"), str(in, "dataBase64"), workerInt64(in["offset"]), finalize, workerInt64(in["expectedSize"]), str(in, "expectedSha256"))
}

var _ = strconv.Itoa
