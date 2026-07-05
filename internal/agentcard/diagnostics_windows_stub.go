//go:build !windows

package agentcard

func windowsOSVersion() string {
	return ""
}

func windowsKernelVersion() string {
	return ""
}

func windowsCPUModel() string {
	return ""
}

func windowsRAMGB() int {
	return 0
}

func windowsGPUInfo() []GPUInfo {
	return nil
}
