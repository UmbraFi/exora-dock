package sellerdraft

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestPriceFormulaConformanceFixtures(t *testing.T) {
	encoded, err := os.ReadFile("../../contracts/exora.price-formula.v4.conformance.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Language string `json:"language"`
		Cases    []struct {
			Name       string           `json:"name"`
			Expression string           `json:"expression"`
			Allowed    []string         `json:"allowedVariables"`
			Variables  map[string]int64 `json:"variables"`
			Maximum    int64            `json:"maximumChargePerInvocationAtomic"`
			Unbounded  int64            `json:"unboundedAtomic"`
			Billed     int64            `json:"billedAtomic"`
			SHA256     string           `json:"astSha256"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Language != priceFormulaLanguage {
		t.Fatalf("fixture language=%s", fixture.Language)
	}
	for _, test := range fixture.Cases {
		t.Run(test.Name, func(t *testing.T) {
			allowed := map[string]bool{}
			for _, variable := range test.Allowed {
				allowed[variable] = true
			}
			compiled, err := compilePriceFormula(test.Expression, allowed)
			if err != nil {
				t.Fatal(err)
			}
			if test.SHA256 != "" && compiled.sha256 != test.SHA256 {
				t.Fatalf("astSha256=%s want=%s", compiled.sha256, test.SHA256)
			}
			unbounded, billed, err := evaluateCompiledPriceFormula(compiled, test.Variables, test.Maximum)
			if err != nil {
				t.Fatal(err)
			}
			if unbounded != test.Unbounded || billed != test.Billed {
				t.Fatalf("amounts=(%d,%d), want=(%d,%d)", unbounded, billed, test.Unbounded, test.Billed)
			}
		})
	}
}

func TestPriceFormulaSupportsTemplatesConditionsAndExactMoney(t *testing.T) {
	allowed := map[string]bool{"input_tokens": true, "output_tokens": true, "execution_second": true, "delivered": true}
	tests := []struct {
		name       string
		expression string
		usage      map[string]int64
		maximum    int64
		unbounded  int64
		billed     int64
	}{
		{name: "fixed", expression: "0.10", usage: map[string]int64{}, maximum: 100000, unbounded: 100000, billed: 100000},
		{name: "delivery only", expression: "delivered * 0.02", usage: map[string]int64{"delivered": 1}, maximum: 100000, unbounded: 20000, billed: 20000},
		{name: "llm proportional", expression: "0.01 + input_tokens * 1.50 / 1000000 + output_tokens * 2 / 1000000", usage: map[string]int64{"input_tokens": 1000, "output_tokens": 2000}, maximum: 100000, unbounded: 15500, billed: 15500},
		{name: "time blocks", expression: "0.02 + ceil(execution_second / 60) * 0.03", usage: map[string]int64{"execution_second": 61}, maximum: 100000, unbounded: 80000, billed: 80000},
		{name: "conditional tier", expression: "if(input_tokens <= 1000, 0.01, 0.02 + (input_tokens - 1000) * 1 / 1000000)", usage: map[string]int64{"input_tokens": 2000}, maximum: 100000, unbounded: 21000, billed: 21000},
		{name: "cap", expression: "output_tokens * 1 / 1000", usage: map[string]int64{"output_tokens": 5000}, maximum: 125000, unbounded: 5000000, billed: 125000},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			compiled, err := compilePriceFormula(test.expression, allowed)
			if err != nil {
				t.Fatal(err)
			}
			unbounded, billed, err := evaluateCompiledPriceFormula(compiled, test.usage, test.maximum)
			if err != nil {
				t.Fatal(err)
			}
			if unbounded != test.unbounded || billed != test.billed {
				t.Fatalf("amounts=(%d,%d), want=(%d,%d)", unbounded, billed, test.unbounded, test.billed)
			}
		})
	}
}

func TestPriceFormulaCanonicalHashIgnoresWhitespaceAndTracksVariables(t *testing.T) {
	allowed := map[string]bool{"input_tokens": true, "output_tokens": true}
	left, err := compilePriceFormula("input_tokens * 1.5 / 1000 + output_tokens * 2 / 1000", allowed)
	if err != nil {
		t.Fatal(err)
	}
	right, err := compilePriceFormula(" input_tokens*1.50/1000+output_tokens*2/1000 ", allowed)
	if err != nil {
		t.Fatal(err)
	}
	if left.sha256 != right.sha256 || left.canonical != right.canonical {
		t.Fatalf("canonical formula drifted: %#v %#v", left, right)
	}
	if strings.Join(left.variables, ",") != "input_tokens,output_tokens" {
		t.Fatalf("variables=%v", left.variables)
	}
}

func TestPriceFormulaRejectsUnsafeOrUnverifiableExpressions(t *testing.T) {
	allowed := map[string]bool{"input_tokens": true}
	for _, expression := range []string{
		"unknown_tokens * 0.01",
		"process.exit(1)",
		"random()",
		"if(input_tokens > 1, 0.1, -1)",
	} {
		if _, err := compilePriceFormula(expression, allowed); err == nil {
			t.Errorf("unsafe formula accepted: %s", expression)
		}
	}
}

func TestPriceFormulaRejectsDivisionByZeroAtEvaluation(t *testing.T) {
	compiled, err := compilePriceFormula("input_tokens / output_tokens", map[string]bool{"input_tokens": true, "output_tokens": true})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = evaluateCompiledPriceFormula(compiled, map[string]int64{"input_tokens": 10, "output_tokens": 0}, 100000); err == nil {
		t.Fatal("division by zero was accepted")
	}
}

func TestPriceFormulaRejectsNegativeQualificationSample(t *testing.T) {
	compiled, err := compilePriceFormula("input_tokens - 1000", map[string]bool{"input_tokens": true})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = evaluateCompiledPriceFormula(compiled, map[string]int64{"input_tokens": 10}, 100000); err == nil {
		t.Fatal("negative formula result was accepted")
	}
}

func TestPriceFormulaEnforcesComplexityBudgets(t *testing.T) {
	tooLong := strings.Repeat("1+", 512) + "1"
	tooDeep := strings.Repeat("(", 17) + "1" + strings.Repeat(")", 17)
	tooManyNodes := strings.Repeat("1+", 70) + "1"
	variables := make([]string, 17)
	allowed := map[string]bool{}
	for index := range variables {
		variables[index] = fmt.Sprintf("v%d", index)
		allowed[variables[index]] = true
	}
	tooManyVariables := strings.Join(variables, "+")
	for _, expression := range []string{tooLong, tooDeep, tooManyNodes, tooManyVariables} {
		if _, err := compilePriceFormula(expression, allowed); err == nil {
			t.Fatalf("complex formula was accepted: %.80s", expression)
		}
	}
}

func FuzzPriceFormulaDoesNotPanic(f *testing.F) {
	for _, seed := range []string{"0.10", "input_tokens * 1.5 / 1000000", "if(input_tokens > 100, 0.2, 0.1)", "process.exit(1)", strings.Repeat("(", 40)} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, expression string) {
		defer func() {
			if recovered := recover(); recovered != nil {
				t.Fatalf("formula parser panicked for %q: %v", expression, recovered)
			}
		}()
		compiled, err := compilePriceFormula(expression, map[string]bool{"input_tokens": true, "output_tokens": true, "execution_second": true})
		if err == nil {
			_, _, _ = evaluateCompiledPriceFormula(compiled, map[string]int64{"input_tokens": 1, "output_tokens": 1, "execution_second": 1}, 1000000)
		}
	})
}
