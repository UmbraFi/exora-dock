//go:build windows

package agentcard

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func storageInfo() []StorageInfo {
	wd, err := os.Getwd()
	if err != nil || wd == "" {
		wd = "."
	}
	root := filepath.VolumeName(wd)
	if root != "" {
		root += string(os.PathSeparator)
	} else {
		root = wd
	}
	path, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return nil
	}
	var freeAvailable, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(path, &freeAvailable, &total, &free); err != nil {
		return nil
	}
	return storageFromBytes(total, freeAvailable)
}
