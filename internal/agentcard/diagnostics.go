package agentcard

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const diagnosticsVersion = "safe-local-diagnostics/v0.2"

type DiagnosticsConfig struct {
	LLMProvider        string
	LLMConfigured      bool
	SellerAgentEnabled bool
	CommandExecutor    bool
	MCPAvailable       bool
}

func CollectDiagnostics(cfg DiagnosticsConfig) Diagnostics {
	now := time.Now().UTC()
	diag := Diagnostics{
		CollectedAt:        now.Format(time.RFC3339),
		ExpiresAt:          now.Add(24 * time.Hour).Format(time.RFC3339),
		OS:                 runtime.GOOS,
		OSVersion:          osVersion(),
		KernelVersion:      kernelVersion(),
		Arch:               runtime.GOARCH,
		CPUCores:           runtime.NumCPU(),
		CPUModel:           cpuModel(),
		RAMGB:              ramGB(),
		GPUs:               gpuInfo(),
		Storage:            storageInfo(),
		LLMProvider:        safeProvider(cfg.LLMProvider),
		LLMConfigured:      cfg.LLMConfigured,
		SellerAgentEnabled: cfg.SellerAgentEnabled,
		CommandExecutor:    cfg.CommandExecutor,
		MCPAvailable:       cfg.MCPAvailable,
		MCPEntrypoint:      "exora-dock mcp",
		NetworkCheck:       "not measured",
		RedactionSummary:   "Secrets, private keys, raw credentials, internal endpoints, and full private paths are excluded.",
		DiagnosticsVersion: diagnosticsVersion,
	}
	if out, ok := runVersion(900*time.Millisecond, "docker", "--version"); ok {
		diag.DockerAvailable = true
		diag.DockerVersion = out
	}
	if out, ok := runVersion(700*time.Millisecond, "python", "--version"); ok {
		diag.PythonVersion = out
	} else if out, ok := runVersion(700*time.Millisecond, "python3", "--version"); ok {
		diag.PythonVersion = out
	}
	if out, ok := runVersion(700*time.Millisecond, "node", "--version"); ok {
		diag.NodeVersion = out
	}
	if out, ok := runVersion(700*time.Millisecond, "npm", "--version"); ok {
		diag.NPMVersion = out
	}
	return diag
}

func osVersion() string {
	switch runtime.GOOS {
	case "windows":
		if out := windowsOSVersion(); out != "" {
			return out
		}
	case "darwin":
		if out, ok := runVersion(700*time.Millisecond, "sw_vers", "-productVersion"); ok {
			return "macOS " + out
		}
	case "linux":
		if out := linuxPrettyName("/etc/os-release"); out != "" {
			return out
		}
	}
	return ""
}

func kernelVersion() string {
	switch runtime.GOOS {
	case "windows":
		if out := windowsKernelVersion(); out != "" {
			return out
		}
	case "darwin", "linux":
		if out, ok := runVersion(700*time.Millisecond, "uname", "-r"); ok {
			return out
		}
	}
	return ""
}

func runVersion(timeout time.Duration, name string, args ...string) (string, bool) {
	text, ok := runCommandOutput(timeout, name, args...)
	if !ok {
		return "", false
	}
	return firstLine(text), true
}

func runCommandOutput(timeout time.Duration, name string, args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil || ctx.Err() != nil {
		return "", false
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return "", false
	}
	return text, true
}

func cpuModel() string {
	switch runtime.GOOS {
	case "windows":
		if out := windowsCPUModel(); out != "" {
			return out
		}
	case "darwin":
		if out, ok := runVersion(700*time.Millisecond, "sysctl", "-n", "machdep.cpu.brand_string"); ok {
			return out
		}
	case "linux":
		data, err := os.ReadFile("/proc/cpuinfo")
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if before, after, ok := strings.Cut(line, ":"); ok && strings.TrimSpace(before) == "model name" {
					return strings.TrimSpace(after)
				}
			}
		}
	}
	return ""
}

func ramGB() int {
	var bytes uint64
	switch runtime.GOOS {
	case "windows":
		if gb := windowsRAMGB(); gb > 0 {
			return gb
		}
	case "darwin":
		if out, ok := runVersion(700*time.Millisecond, "sysctl", "-n", "hw.memsize"); ok {
			bytes = parseUint(out)
		}
	case "linux":
		data, err := os.ReadFile("/proc/meminfo")
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(line, "MemTotal:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						bytes = parseUint(fields[1]) * 1024
					}
					break
				}
			}
		}
	}
	if bytes == 0 {
		return 0
	}
	gb := int((bytes + (1 << 30) - 1) / (1 << 30))
	if gb < 0 {
		return 0
	}
	return gb
}

func storageFromBytes(totalBytes, freeBytes uint64) []StorageInfo {
	if totalBytes == 0 {
		return nil
	}
	if freeBytes > totalBytes {
		freeBytes = totalBytes
	}
	return []StorageInfo{{
		Label:       "system",
		TotalGB:     bytesToGB(totalBytes),
		FreeGB:      bytesToGB(freeBytes),
		UsedPercent: usedPercent(totalBytes, freeBytes),
	}}
}

func bytesToGB(bytes uint64) int {
	if bytes == 0 {
		return 0
	}
	gb := (bytes + (1 << 30) - 1) / (1 << 30)
	if gb > uint64(^uint(0)>>1) {
		return int(^uint(0) >> 1)
	}
	return int(gb)
}

func usedPercent(totalBytes, freeBytes uint64) int {
	if totalBytes == 0 {
		return 0
	}
	if freeBytes > totalBytes {
		freeBytes = totalBytes
	}
	used := totalBytes - freeBytes
	percent := int((used*100 + totalBytes/2) / totalBytes)
	if percent < 0 {
		return 0
	}
	if percent > 100 {
		return 100
	}
	return percent
}

func gpuInfo() []GPUInfo {
	out, ok := runCommandOutput(1200*time.Millisecond, "nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits")
	if !ok {
		return windowsGPUInfo()
	}
	gpus := []GPUInfo{}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Split(line, ",")
		if len(parts) == 0 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "" {
			continue
		}
		vram := 0
		if len(parts) > 1 {
			mb := parseUint(parts[1])
			if mb > 0 {
				vram = int((mb + 1023) / 1024)
			}
		}
		gpus = append(gpus, GPUInfo{Name: name, VRAMGB: vram})
	}
	return gpus
}

func parseUint(value string) uint64 {
	value = strings.TrimSpace(value)
	if fields := strings.Fields(value); len(fields) > 0 {
		value = fields[0]
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func linuxPrettyName(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if unquoted, err := strconv.Unquote(value); err == nil {
			value = unquoted
		}
		values[key] = value
	}
	if values["PRETTY_NAME"] != "" {
		return values["PRETTY_NAME"]
	}
	return strings.TrimSpace(strings.Join([]string{values["NAME"], values["VERSION"]}, " "))
}

func safeProvider(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, "https://", "")
	value = strings.ReplaceAll(value, "http://", "")
	value = strings.TrimRight(value, "/")
	if before, _, ok := strings.Cut(value, "/"); ok {
		value = before
	}
	return value
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if before, _, ok := strings.Cut(value, "\n"); ok {
		return strings.TrimSpace(before)
	}
	return value
}
