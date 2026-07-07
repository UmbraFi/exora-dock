package agentcard

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

const diagnosticsVersion = "safe-local-diagnostics/v0.4"

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
	pythonCommand := ""
	if out, ok := runVersion(700*time.Millisecond, "python", "--version"); ok {
		diag.PythonVersion = out
		pythonCommand = "python"
	} else if out, ok := runVersion(700*time.Millisecond, "python3", "--version"); ok {
		diag.PythonVersion = out
		pythonCommand = "python3"
	}
	if out, ok := runVersion(700*time.Millisecond, "node", "--version"); ok {
		diag.NodeVersion = out
	}
	if out, ok := runVersion(700*time.Millisecond, "npm", "--version"); ok {
		diag.NPMVersion = out
	}
	diag.CodeEnvironment = codeEnvironmentInfo(diag, pythonCommand)
	diag.Dependencies = dependencyInfo(pythonCommand)
	return diag
}

func codeEnvironmentInfo(diag Diagnostics, pythonCommand string) []DependencyInfo {
	out := []DependencyInfo{}
	out = appendDependencyInfoLocation(out, "Go", runtime.Version(), "runtime", commandLocation("go"))
	if diag.DockerAvailable {
		out = appendDependencyInfoLocation(out, "Docker", diag.DockerVersion, "runtime", commandLocation("docker"))
	}
	if diag.PythonVersion != "" {
		out = appendDependencyInfoLocation(out, "Python", diag.PythonVersion, "runtime", pythonExecutable(pythonCommand))
		out = append(out, pythonEnvironmentInfo(pythonCommand)...)
		if version, location := pipInfo(pythonCommand); version != "" {
			out = appendDependencyInfoLocation(out, "pip", version, "python package manager", location)
		}
	}
	if diag.NodeVersion != "" {
		out = appendDependencyInfoLocation(out, "Node.js", "Node "+diag.NodeVersion, "runtime", commandLocation("node"))
	}
	if diag.NPMVersion != "" {
		out = appendDependencyInfoLocation(out, "npm", "npm "+diag.NPMVersion, "runtime", commandLocation("npm"))
	}
	out = appendCUDAEnvironmentInfo(out)
	if diag.MCPAvailable {
		out = appendDependencyInfo(out, "MCP", firstNonEmpty(diag.MCPEntrypoint, "available"), "agent bridge")
	}
	if diag.LLMConfigured {
		out = appendDependencyInfo(out, "LLM provider", firstNonEmpty(diag.LLMProvider, "configured"), "agent bridge")
	}
	return out
}

func dependencyInfo(pythonCommand string) []DependencyInfo {
	info, ok := debug.ReadBuildInfo()
	out := []DependencyInfo{}
	out = append(out, pythonPackageInfo(pythonCommand)...)
	if ok {
		if info.Main.Path != "" {
			out = appendDependencyInfo(out, info.Main.Path, moduleVersion(info.Main.Version, nil), "go module")
		}
		for _, dep := range info.Deps {
			out = appendDependencyInfo(out, dep.Path, moduleVersion(dep.Version, dep.Replace), "go module")
		}
	}
	return out
}

func moduleVersion(version string, replacement *debug.Module) string {
	version = strings.TrimSpace(version)
	if replacement != nil {
		if strings.TrimSpace(replacement.Version) != "" {
			return strings.TrimSpace(replacement.Version)
		}
		if strings.TrimSpace(version) != "" {
			return version
		}
		return "local replacement"
	}
	if version == "" || version == "(devel)" {
		return "devel"
	}
	return version
}

const pythonPackageProbeScript = `
import importlib.metadata as md
import importlib.util as util
import json

targets = [
    {"name": "numpy", "import": "numpy", "dists": ["numpy"], "fallbackImport": True},
    {"name": "cupy", "import": "cupy", "dists": ["cupy", "cupy-cuda12x", "cupy-cuda11x"], "fallbackImport": True},
    {"name": "scipy", "import": "scipy", "dists": ["scipy"]},
    {"name": "pandas", "import": "pandas", "dists": ["pandas"]},
    {"name": "numba", "import": "numba", "dists": ["numba"]},
    {"name": "llvmlite", "import": "llvmlite", "dists": ["llvmlite"]},
    {"name": "torch", "import": "torch", "dists": ["torch"]},
    {"name": "torchvision", "import": "torchvision", "dists": ["torchvision"]},
    {"name": "torchaudio", "import": "torchaudio", "dists": ["torchaudio"]},
    {"name": "tensorflow", "import": "tensorflow", "dists": ["tensorflow"]},
    {"name": "jax", "import": "jax", "dists": ["jax"]},
    {"name": "jaxlib", "import": "jaxlib", "dists": ["jaxlib"]},
    {"name": "onnxruntime", "import": "onnxruntime", "dists": ["onnxruntime", "onnxruntime-gpu"]},
    {"name": "cuda-python", "import": "cuda", "dists": ["cuda-python"]},
    {"name": "nvidia-cuda-runtime-cu12", "import": "", "dists": ["nvidia-cuda-runtime-cu12"]},
    {"name": "nvidia-cublas-cu12", "import": "", "dists": ["nvidia-cublas-cu12"]},
    {"name": "nvidia-cudnn-cu12", "import": "", "dists": ["nvidia-cudnn-cu12"]},
    {"name": "nvidia-cufft-cu12", "import": "", "dists": ["nvidia-cufft-cu12"]},
    {"name": "triton", "import": "triton", "dists": ["triton"]},
]

out = []
for target in targets:
    import_name = target["import"]
    spec = None
    if import_name:
        try:
            spec = util.find_spec(import_name)
        except Exception:
            spec = None
    version = ""
    for dist in target["dists"]:
        try:
            version = md.version(dist)
            break
        except md.PackageNotFoundError:
            pass
        except Exception:
            pass
    if spec is None and not version:
        continue
    if not version and target.get("fallbackImport") and import_name:
        try:
            module = __import__(import_name)
            version = getattr(module, "__version__", "") or version
        except Exception:
            pass
    location = ""
    if spec is not None:
        try:
            locations = list(spec.submodule_search_locations or [])
            location = locations[0] if locations else (spec.origin or "")
        except Exception:
            location = ""
    out.append({"name": target["name"], "version": version or "installed", "location": location})
print("EXORA_JSON:" + json.dumps(out))
`

type pythonPackageProbeItem struct {
	Name     string `json:"name"`
	Version  string `json:"version"`
	Location string `json:"location"`
}

const pythonEnvironmentProbeScript = `
import json
import os
import site
import sys

prefix = sys.prefix
base_prefix = getattr(sys, "base_prefix", prefix)
conda_prefix = os.environ.get("CONDA_PREFIX", "")
venv = os.environ.get("VIRTUAL_ENV", "")
env_type = "system"
env_name = ""
env_location = prefix

if conda_prefix:
    env_type = "conda"
    env_name = os.environ.get("CONDA_DEFAULT_ENV", "") or os.path.basename(conda_prefix)
    env_location = conda_prefix
elif venv:
    env_type = "venv"
    env_name = os.path.basename(venv)
    env_location = venv
elif prefix != base_prefix:
    env_type = "venv"
    env_name = os.path.basename(prefix)

try:
    site_packages = site.getsitepackages()
except Exception:
    site_packages = []

if not site_packages:
    try:
        user_site = site.getusersitepackages()
        if user_site:
            site_packages = [user_site]
    except Exception:
        site_packages = []

print("EXORA_JSON:" + json.dumps({
    "environmentType": env_type,
    "environmentName": env_name,
    "environmentLocation": env_location,
    "prefix": prefix,
    "sitePackages": site_packages,
}))
`

type pythonEnvironmentProbe struct {
	EnvironmentType     string   `json:"environmentType"`
	EnvironmentName     string   `json:"environmentName"`
	EnvironmentLocation string   `json:"environmentLocation"`
	Prefix              string   `json:"prefix"`
	SitePackages        []string `json:"sitePackages"`
}

func pythonEnvironmentInfo(command string) []DependencyInfo {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil
	}
	out, ok := runCommandOutput(1200*time.Millisecond, command, "-c", pythonEnvironmentProbeScript)
	if !ok {
		return nil
	}
	jsonText := exoraJSONPayload(out)
	var info pythonEnvironmentProbe
	if err := json.Unmarshal([]byte(jsonText), &info); err != nil {
		return nil
	}
	envType := firstNonEmpty(strings.TrimSpace(info.EnvironmentType), "system")
	envName := strings.TrimSpace(info.EnvironmentName)
	envVersion := envType
	if envName != "" {
		envVersion = envType + ": " + envName
	}
	location := firstNonEmpty(info.EnvironmentLocation, info.Prefix)
	deps := []DependencyInfo{}
	deps = appendDependencyInfoLocation(deps, "Python environment", envVersion, "python environment", location)
	for _, sitePackage := range info.SitePackages {
		deps = appendDependencyInfoLocation(deps, "Python site-packages", "site-packages", "python environment", sitePackage)
		break
	}
	return deps
}

func pythonPackageInfo(command string) []DependencyInfo {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil
	}
	out, ok := runCommandOutput(3500*time.Millisecond, command, "-c", pythonPackageProbeScript)
	if !ok {
		return nil
	}
	jsonText := exoraJSONPayload(out)
	var items []pythonPackageProbeItem
	if err := json.Unmarshal([]byte(jsonText), &items); err != nil {
		return nil
	}
	deps := []DependencyInfo{}
	for _, item := range items {
		deps = appendDependencyInfoLocation(deps, item.Name, firstNonEmpty(item.Version, "installed"), "python package", safeLocalPath(item.Location))
	}
	return deps
}

func exoraJSONPayload(out string) string {
	jsonText := strings.TrimSpace(out)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "EXORA_JSON:") {
			jsonText = strings.TrimSpace(strings.TrimPrefix(line, "EXORA_JSON:"))
		}
	}
	return jsonText
}

func pythonExecutable(command string) string {
	command = strings.TrimSpace(command)
	if command == "" {
		return ""
	}
	if out, ok := runVersion(700*time.Millisecond, command, "-c", "import sys; print(sys.executable)"); ok {
		return safeLocalPath(out)
	}
	return commandLocation(command)
}

func pipInfo(command string) (string, string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", ""
	}
	out, ok := runVersion(1200*time.Millisecond, command, "-m", "pip", "--version")
	if !ok {
		return "", ""
	}
	version := out
	location := ""
	if before, after, ok := strings.Cut(out, " from "); ok {
		version = strings.TrimSpace(before)
		if loc, _, ok := strings.Cut(after, " ("); ok {
			location = safeLocalPath(loc)
		}
	}
	return version, location
}

func appendCUDAEnvironmentInfo(out []DependencyInfo) []DependencyInfo {
	if smi, ok := runCommandOutput(1200*time.Millisecond, "nvidia-smi"); ok {
		if version := parseNVIDIASMICUDAVersion(smi); version != "" {
			out = appendDependencyInfoLocation(out, "NVIDIA CUDA runtime", "CUDA "+version, "cuda", commandLocation("nvidia-smi"))
		}
	}
	if nvcc, ok := runCommandOutput(1200*time.Millisecond, "nvcc", "--version"); ok {
		version := parseNVCCVersion(nvcc)
		if version == "" {
			version = firstLine(nvcc)
		}
		out = appendDependencyInfoLocation(out, "CUDA Toolkit", version, "cuda", commandLocation("nvcc"))
	} else if cudaPath := safeLocalPath(os.Getenv("CUDA_PATH")); cudaPath != "" {
		out = appendDependencyInfoLocation(out, "CUDA Toolkit", "installed", "cuda", cudaPath)
	}
	return out
}

func parseNVIDIASMICUDAVersion(value string) string {
	const marker = "CUDA Version:"
	index := strings.Index(value, marker)
	if index < 0 {
		return ""
	}
	rest := strings.TrimSpace(value[index+len(marker):])
	if fields := strings.Fields(rest); len(fields) > 0 {
		return strings.Trim(fields[0], "|")
	}
	return ""
}

func parseNVCCVersion(value string) string {
	if index := strings.Index(value, "release "); index >= 0 {
		rest := strings.TrimSpace(value[index+len("release "):])
		if before, _, ok := strings.Cut(rest, ","); ok {
			rest = before
		} else if fields := strings.Fields(rest); len(fields) > 0 {
			rest = fields[0]
		}
		rest = strings.TrimSpace(rest)
		if rest != "" {
			return "CUDA " + rest
		}
	}
	if index := strings.LastIndex(value, "V"); index >= 0 {
		rest := strings.TrimSpace(value[index+1:])
		if rest != "" && parseUint(rest) > 0 {
			return "CUDA " + rest
		}
	}
	return ""
}

func appendDependencyInfo(out []DependencyInfo, name, version, source string) []DependencyInfo {
	return appendDependencyInfoLocation(out, name, version, source, "")
}

func appendDependencyInfoLocation(out []DependencyInfo, name, version, source, location string) []DependencyInfo {
	name = strings.TrimSpace(name)
	version = strings.TrimSpace(version)
	source = strings.TrimSpace(source)
	location = safeLocalPath(location)
	if name == "" || version == "" {
		return out
	}
	for _, item := range out {
		if item.Name == name && item.Source == source {
			return out
		}
	}
	return append(out, DependencyInfo{Name: name, Version: version, Source: source, Location: location})
}

func commandLocation(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	resolved, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return safeLocalPath(resolved)
}

func safeLocalPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	cleaned := filepath.Clean(value)
	if cleaned == "." {
		return ""
	}
	if wd, err := os.Getwd(); err == nil {
		if redacted, ok := redactPathPrefix(cleaned, wd, "<workspace>"); ok {
			return redacted
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if redacted, ok := redactPathPrefix(cleaned, home, "~"); ok {
			return redacted
		}
	}
	return cleaned
}

func redactPathPrefix(value, root, label string) (string, bool) {
	value = filepath.Clean(strings.TrimSpace(value))
	root = filepath.Clean(strings.TrimSpace(root))
	if value == "" || root == "" || value == "." || root == "." {
		return "", false
	}
	rel, err := filepath.Rel(root, value)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == "." {
		return label, true
	}
	return label + string(filepath.Separator) + rel, true
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
	out, ok := runCommandOutput(1200*time.Millisecond, "nvidia-smi", "--query-gpu=name,memory.total,driver_version,pci.device_id", "--format=csv,noheader,nounits")
	if !ok {
		switch runtime.GOOS {
		case "windows":
			return windowsGPUInfo()
		case "darwin":
			return darwinGPUInfo()
		case "linux":
			return linuxGPUInfo()
		default:
			return nil
		}
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
		gpus = append(gpus, GPUInfo{
			Name:          name,
			Chip:          name,
			VRAMGB:        vram,
			DriverVersion: fieldAt(parts, 2),
			DeviceID:      normalizeDeviceID(fieldAt(parts, 3)),
		})
	}
	return gpus
}

func darwinGPUInfo() []GPUInfo {
	out, ok := runCommandOutput(2500*time.Millisecond, "system_profiler", "SPDisplaysDataType")
	if !ok {
		return nil
	}
	gpus := []GPUInfo{}
	current := GPUInfo{}
	flush := func() {
		if current.Name != "" {
			if current.Chip == "" {
				current.Chip = current.Name
			}
			gpus = append(gpus, current)
		}
		current = GPUInfo{}
	}
	for _, line := range strings.Split(out, "\n") {
		text := strings.TrimSpace(line)
		if strings.HasPrefix(text, "Chipset Model:") {
			flush()
			current.Name = strings.TrimSpace(strings.TrimPrefix(text, "Chipset Model:"))
			current.Chip = current.Name
		}
		if strings.HasPrefix(text, "Device ID:") {
			current.DeviceID = normalizeDeviceID(strings.TrimSpace(strings.TrimPrefix(text, "Device ID:")))
		}
		if strings.HasPrefix(text, "VRAM") {
			_, value, ok := strings.Cut(text, ":")
			if ok {
				current.VRAMGB = parseMemoryTextGB(value)
			}
		}
	}
	flush()
	return gpus
}

func linuxGPUInfo() []GPUInfo {
	out, ok := runCommandOutput(1200*time.Millisecond, "lspci", "-nn")
	if !ok {
		return nil
	}
	gpus := []GPUInfo{}
	for _, line := range strings.Split(out, "\n") {
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "vga") && !strings.Contains(lower, "3d controller") && !strings.Contains(lower, "display controller") {
			continue
		}
		name := strings.TrimSpace(line)
		if before, after, ok := strings.Cut(name, ": "); ok && strings.Contains(before, ".") {
			name = strings.TrimSpace(after)
		}
		if name == "" {
			continue
		}
		gpus = append(gpus, GPUInfo{
			Name:     name,
			Chip:     name,
			DeviceID: normalizeDeviceID(line),
		})
	}
	return gpus
}

func fieldAt(parts []string, index int) string {
	if len(parts) <= index {
		return ""
	}
	return strings.TrimSpace(parts[index])
}

func normalizeDeviceID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	upper := strings.ToUpper(value)
	if ven := strings.Index(upper, "VEN_"); ven >= 0 {
		token := upper[ven:]
		if end := strings.IndexAny(token, `\ `); end >= 0 {
			token = token[:end]
		}
		parts := strings.Split(token, "&")
		out := []string{}
		for _, part := range parts {
			if strings.HasPrefix(part, "VEN_") || strings.HasPrefix(part, "DEV_") || strings.HasPrefix(part, "SUBSYS_") {
				out = append(out, part)
			}
		}
		return strings.Join(out, "&")
	}
	if open := strings.LastIndex(value, "["); open >= 0 {
		if close := strings.Index(value[open:], "]"); close > 0 {
			return strings.TrimSpace(value[open+1 : open+close])
		}
	}
	return value
}

func parseMemoryTextGB(value string) int {
	value = strings.TrimSpace(strings.ToUpper(value))
	number := parseUint(value)
	if number == 0 {
		return 0
	}
	if strings.Contains(value, "MB") {
		return int((number + 1023) / 1024)
	}
	return int(number)
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
