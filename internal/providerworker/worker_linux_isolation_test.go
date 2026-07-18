//go:build linux

package providerworker

import (
	"strings"
	"testing"
)

func TestIsolatedDomainRemovesNetworkingAndAddsVsockWorkspace(t *testing.T) {
	xml:=`<domain><devices><interface type='network'><source network='default'/></interface><filesystem type='mount'><source dir='/unsafe'/></filesystem></devices></domain>`
	out:=isolateLeaseDomainXML(xml,"/var/lib/exora/workspace")
	if strings.Contains(out,"<interface") || strings.Contains(out,"/unsafe") { t.Fatalf("network or unsafe share survived: %s",out) }
	for _,required:=range []string{"<vsock","virtiofs","exora-workspace","/var/lib/exora/workspace"}{if !strings.Contains(out,required){t.Fatalf("missing %s: %s",required,out)}}
}
