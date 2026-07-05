//go:build windows

package agentcard

import (
	"fmt"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var procGlobalMemoryStatusEx = syscall.NewLazyDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

type memoryStatusEx struct {
	length               uint32
	memoryLoad           uint32
	totalPhys            uint64
	availPhys            uint64
	totalPageFile        uint64
	availPageFile        uint64
	totalVirtual         uint64
	availVirtual         uint64
	availExtendedVirtual uint64
}

func windowsOSVersion() string {
	info := windows.RtlGetVersion()
	name := windowsRegistryString(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "ProductName")
	if info != nil && info.BuildNumber >= 22000 && strings.Contains(name, "Windows 10") {
		name = strings.Replace(name, "Windows 10", "Windows 11", 1)
	}
	if name == "" {
		name = windowsMarketingName(info)
	}
	displayVersion := windowsRegistryString(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "DisplayVersion")
	if displayVersion == "" {
		displayVersion = windowsRegistryString(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "ReleaseId")
	}
	build := windowsBuildVersion(info)
	parts := []string{name}
	if displayVersion != "" {
		parts = append(parts, displayVersion)
	}
	if build != "" {
		parts = append(parts, fmt.Sprintf("(build %s)", build))
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func windowsKernelVersion() string {
	return windowsBuildVersion(windows.RtlGetVersion())
}

func windowsCPUModel() string {
	if out := windowsRegistryString(`HARDWARE\DESCRIPTION\System\CentralProcessor\0`, "ProcessorNameString"); out != "" {
		return out
	}
	if out, ok := windowsPowerShellOutput(2500*time.Millisecond, "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"); ok {
		return firstLine(out)
	}
	return ""
}

func windowsRAMGB() int {
	status := memoryStatusEx{length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	ret, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status)))
	if ret == 0 {
		if out, ok := windowsPowerShellOutput(2500*time.Millisecond, "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"); ok {
			return bytesToGB(parseUint(out))
		}
		return 0
	}
	return bytesToGB(status.totalPhys)
}

func windowsGPUInfo() []GPUInfo {
	out, ok := windowsPowerShellOutput(3000*time.Millisecond, "Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | ForEach-Object { \"$($_.Name)|$($_.AdapterRAM)\" }")
	if !ok {
		return nil
	}
	gpus := []GPUInfo{}
	for _, line := range strings.Split(out, "\n") {
		name, ramText, _ := strings.Cut(strings.TrimSpace(line), "|")
		name = strings.TrimSpace(name)
		if name == "" || strings.Contains(strings.ToLower(name), "basic render") {
			continue
		}
		vram := 0
		if bytes := parseUint(ramText); bytes > 0 {
			vram = bytesToGB(bytes)
		}
		gpus = append(gpus, GPUInfo{Name: name, VRAMGB: vram})
	}
	return gpus
}

func windowsBuildVersion(info *windows.OsVersionInfoEx) string {
	major, minor, build := uint32(0), uint32(0), uint32(0)
	if info != nil {
		major, minor, build = info.MajorVersion, info.MinorVersion, info.BuildNumber
	}
	if build == 0 {
		build = uint32(windowsRegistryInteger(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "CurrentBuildNumber"))
	}
	if major == 0 {
		major = uint32(windowsRegistryInteger(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "CurrentMajorVersionNumber"))
	}
	if minor == 0 {
		minor = uint32(windowsRegistryInteger(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "CurrentMinorVersionNumber"))
	}
	if major == 0 && build == 0 {
		return ""
	}
	base := fmt.Sprintf("%d.%d.%d", major, minor, build)
	if ubr := windowsRegistryInteger(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, "UBR"); ubr > 0 {
		return fmt.Sprintf("%s.%d", base, ubr)
	}
	return base
}

func windowsMarketingName(info *windows.OsVersionInfoEx) string {
	if info != nil && info.BuildNumber >= 22000 {
		return "Windows 11"
	}
	return "Windows"
}

func windowsRegistryString(path, name string) string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer key.Close()
	value, _, err := key.GetStringValue(name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func windowsRegistryInteger(path, name string) uint64 {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return 0
	}
	defer key.Close()
	value, _, err := key.GetIntegerValue(name)
	if err != nil {
		if text, _, err := key.GetStringValue(name); err == nil {
			return parseUint(text)
		}
		return 0
	}
	return value
}

func windowsPowerShellOutput(timeout time.Duration, script string) (string, bool) {
	args := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script}
	for _, name := range []string{"powershell.exe", "powershell", "pwsh.exe", "pwsh"} {
		if out, ok := runCommandOutput(timeout, name, args...); ok {
			return out, true
		}
	}
	return "", false
}
