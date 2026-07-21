package sellerdraft

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"unicode"
)

const (
	priceFormulaLanguage = "exora.price-formula.v4"
	settlementPolicyV4   = "exora.operation-settlement.v4"
	formulaMaxLength     = 1024
	formulaMaxNodes      = 128
	formulaMaxDepth      = 16
	formulaMaxVariables  = 16
	formulaMaxSteps      = 512
)

type formulaToken struct {
	kind, text string
	position   int
}

type priceFormulaNode struct {
	kind  string
	value string
	args  []*priceFormulaNode
}

type compiledPriceFormula struct {
	root      *priceFormulaNode
	variables []string
	canonical string
	sha256    string
}

type priceFormulaParser struct {
	tokens []formulaToken
	index  int
	nodes  int
}

type formulaValue struct {
	number  *big.Rat
	boolean *bool
}

type formulaInterval struct {
	number bool
	min    *big.Rat
	max    *big.Rat
}

func tokenizePriceFormula(expression string) ([]formulaToken, error) {
	if len(expression) == 0 || len(expression) > formulaMaxLength {
		return nil, fmt.Errorf("formula expression must contain 1-%d characters", formulaMaxLength)
	}
	tokens := make([]formulaToken, 0, 32)
	for index := 0; index < len(expression); {
		character := rune(expression[index])
		if unicode.IsSpace(character) {
			index++
			continue
		}
		if character >= '0' && character <= '9' || character == '.' {
			start, dots := index, 0
			for index < len(expression) {
				current := expression[index]
				if current == '.' {
					dots++
				} else if current < '0' || current > '9' {
					break
				}
				index++
			}
			text := expression[start:index]
			if dots > 1 || text == "." {
				return nil, fmt.Errorf("invalid decimal at position %d", start+1)
			}
			parts := strings.SplitN(text, ".", 2)
			if len(parts) == 2 && len(parts[1]) > 6 {
				return nil, fmt.Errorf("money constants support at most six decimal places at position %d", start+1)
			}
			tokens = append(tokens, formulaToken{kind: "number", text: text, position: start})
			continue
		}
		if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' || character == '_' {
			start := index
			for index < len(expression) {
				current := expression[index]
				if !(current >= 'A' && current <= 'Z') && !(current >= 'a' && current <= 'z') && !(current >= '0' && current <= '9') && current != '_' {
					break
				}
				index++
			}
			text := expression[start:index]
			kind := "identifier"
			if text == "and" || text == "or" || text == "not" {
				kind = text
			}
			tokens = append(tokens, formulaToken{kind: kind, text: text, position: start})
			continue
		}
		matched := ""
		if index+1 < len(expression) {
			pair := expression[index : index+2]
			if pair == "<=" || pair == ">=" || pair == "==" || pair == "!=" {
				matched = pair
			}
		}
		if matched != "" {
			tokens = append(tokens, formulaToken{kind: matched, text: matched, position: index})
			index += 2
			continue
		}
		if strings.ContainsRune("+-*/(),<>", character) {
			text := string(character)
			tokens = append(tokens, formulaToken{kind: text, text: text, position: index})
			index++
			continue
		}
		return nil, fmt.Errorf("unsupported formula character %q at position %d", character, index+1)
	}
	tokens = append(tokens, formulaToken{kind: "eof", position: len(expression)})
	return tokens, nil
}

func (parser *priceFormulaParser) current() formulaToken { return parser.tokens[parser.index] }
func (parser *priceFormulaParser) consume(kind string) bool {
	if parser.current().kind != kind {
		return false
	}
	parser.index++
	return true
}
func (parser *priceFormulaParser) node(kind, value string, args ...*priceFormulaNode) (*priceFormulaNode, error) {
	parser.nodes++
	if parser.nodes > formulaMaxNodes {
		return nil, fmt.Errorf("formula exceeds %d AST nodes", formulaMaxNodes)
	}
	return &priceFormulaNode{kind: kind, value: value, args: args}, nil
}

func (parser *priceFormulaParser) parse() (*priceFormulaNode, error) {
	root, err := parser.parseOr(1)
	if err != nil {
		return nil, err
	}
	if parser.current().kind != "eof" {
		return nil, fmt.Errorf("unexpected token %q at position %d", parser.current().text, parser.current().position+1)
	}
	return root, nil
}

func (parser *priceFormulaParser) checkDepth(depth int) error {
	if depth > formulaMaxDepth {
		return fmt.Errorf("formula exceeds %d levels of nesting", formulaMaxDepth)
	}
	return nil
}

func (parser *priceFormulaParser) parseOr(depth int) (*priceFormulaNode, error) {
	if err := parser.checkDepth(depth); err != nil {
		return nil, err
	}
	left, err := parser.parseAnd(depth)
	if err != nil {
		return nil, err
	}
	for parser.consume("or") {
		right, err := parser.parseAnd(depth)
		if err != nil {
			return nil, err
		}
		left, err = parser.node("binary", "or", left, right)
		if err != nil {
			return nil, err
		}
	}
	return left, nil
}
func (parser *priceFormulaParser) parseAnd(depth int) (*priceFormulaNode, error) {
	left, err := parser.parseCompare(depth)
	if err != nil {
		return nil, err
	}
	for parser.consume("and") {
		right, err := parser.parseCompare(depth)
		if err != nil {
			return nil, err
		}
		left, err = parser.node("binary", "and", left, right)
		if err != nil {
			return nil, err
		}
	}
	return left, nil
}
func (parser *priceFormulaParser) parseCompare(depth int) (*priceFormulaNode, error) {
	left, err := parser.parseAdd(depth)
	if err != nil {
		return nil, err
	}
	for {
		operator := parser.current().kind
		if operator != "<" && operator != "<=" && operator != ">" && operator != ">=" && operator != "==" && operator != "!=" {
			break
		}
		parser.index++
		right, err := parser.parseAdd(depth)
		if err != nil {
			return nil, err
		}
		left, err = parser.node("binary", operator, left, right)
		if err != nil {
			return nil, err
		}
	}
	return left, nil
}
func (parser *priceFormulaParser) parseAdd(depth int) (*priceFormulaNode, error) {
	left, err := parser.parseMultiply(depth)
	if err != nil {
		return nil, err
	}
	for parser.current().kind == "+" || parser.current().kind == "-" {
		operator := parser.current().kind
		parser.index++
		right, err := parser.parseMultiply(depth)
		if err != nil {
			return nil, err
		}
		left, err = parser.node("binary", operator, left, right)
		if err != nil {
			return nil, err
		}
	}
	return left, nil
}
func (parser *priceFormulaParser) parseMultiply(depth int) (*priceFormulaNode, error) {
	left, err := parser.parseUnary(depth)
	if err != nil {
		return nil, err
	}
	for parser.current().kind == "*" || parser.current().kind == "/" {
		operator := parser.current().kind
		parser.index++
		right, err := parser.parseUnary(depth)
		if err != nil {
			return nil, err
		}
		left, err = parser.node("binary", operator, left, right)
		if err != nil {
			return nil, err
		}
	}
	return left, nil
}
func (parser *priceFormulaParser) parseUnary(depth int) (*priceFormulaNode, error) {
	if parser.consume("not") {
		child, err := parser.parseUnary(depth)
		if err != nil {
			return nil, err
		}
		return parser.node("unary", "not", child)
	}
	return parser.parsePrimary(depth)
}
func (parser *priceFormulaParser) parsePrimary(depth int) (*priceFormulaNode, error) {
	if err := parser.checkDepth(depth); err != nil {
		return nil, err
	}
	token := parser.current()
	if token.kind == "number" {
		parser.index++
		return parser.node("number", token.text)
	}
	if token.kind == "identifier" {
		parser.index++
		if !parser.consume("(") {
			return parser.node("variable", token.text)
		}
		args := []*priceFormulaNode{}
		if !parser.consume(")") {
			for {
				item, err := parser.parseOr(depth + 1)
				if err != nil {
					return nil, err
				}
				args = append(args, item)
				if parser.consume(")") {
					break
				}
				if !parser.consume(",") {
					return nil, errors.New("expected ',' or ')' in function call")
				}
			}
		}
		allowed := map[string]int{"min": 2, "max": 2, "ceil": 1, "floor": 1, "if": 3}
		count, ok := allowed[token.text]
		if !ok {
			return nil, fmt.Errorf("function %s is not allowed", token.text)
		}
		if len(args) != count {
			return nil, fmt.Errorf("function %s requires %d arguments", token.text, count)
		}
		return parser.node("call", token.text, args...)
	}
	if parser.consume("(") {
		node, err := parser.parseOr(depth + 1)
		if err != nil {
			return nil, err
		}
		if !parser.consume(")") {
			return nil, errors.New("expected ')'")
		}
		return node, nil
	}
	return nil, fmt.Errorf("unexpected token %q at position %d", token.text, token.position+1)
}

func canonicalFormulaNode(node *priceFormulaNode) string {
	if node.kind == "number" {
		value, _ := new(big.Rat).SetString(node.value)
		return "n:" + value.RatString()
	}
	if node.kind == "variable" {
		return "v:" + node.value
	}
	parts := make([]string, len(node.args))
	for index, child := range node.args {
		parts[index] = canonicalFormulaNode(child)
	}
	return "(" + node.kind + ":" + node.value + " " + strings.Join(parts, " ") + ")"
}

func collectFormulaVariables(node *priceFormulaNode, found map[string]bool) {
	if node.kind == "variable" {
		found[node.value] = true
	}
	for _, child := range node.args {
		collectFormulaVariables(child, found)
	}
}

func priceFormulaValidationSamples(compiled compiledPriceFormula, sample map[string]int64) []map[string]int64 {
	normalize := func(source map[string]int64) map[string]int64 {
		value := map[string]int64{}
		for _, variable := range compiled.variables {
			quantity := source[variable]
			if quantity < 0 {
				quantity = 0
			}
			value[variable] = quantity
		}
		return value
	}
	candidates := []map[string]int64{normalize(sample), normalize(map[string]int64{})}
	ones := map[string]int64{}
	for _, variable := range compiled.variables {
		ones[variable] = 1
	}
	candidates = append(candidates, normalize(ones))
	var visit func(*priceFormulaNode)
	visit = func(node *priceFormulaNode) {
		if node.kind == "binary" && (node.value == "<" || node.value == "<=" || node.value == ">" || node.value == ">=" || node.value == "==" || node.value == "!=") && node.args[0].kind == "variable" && node.args[1].kind == "number" {
			threshold, ok := new(big.Rat).SetString(node.args[1].value)
			if ok && threshold.IsInt() && threshold.Num().IsInt64() && threshold.Sign() >= 0 {
				for _, quantity := range []int64{max(0, threshold.Num().Int64()-1), threshold.Num().Int64(), threshold.Num().Int64() + 1} {
					value := normalize(sample)
					value[node.args[0].value] = quantity
					candidates = append(candidates, value)
				}
			}
		}
		for _, child := range node.args {
			visit(child)
		}
	}
	visit(compiled.root)
	unique := make([]map[string]int64, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		parts := make([]string, len(compiled.variables))
		for index, variable := range compiled.variables {
			parts[index] = fmt.Sprintf("%s=%d", variable, candidate[variable])
		}
		key := strings.Join(parts, ",")
		if !seen[key] {
			seen[key] = true
			unique = append(unique, candidate)
		}
		if len(unique) == 9 {
			break
		}
	}
	return unique
}

func compilePriceFormula(expression string, allowedVariables map[string]bool) (compiledPriceFormula, error) {
	tokens, err := tokenizePriceFormula(strings.TrimSpace(expression))
	if err != nil {
		return compiledPriceFormula{}, err
	}
	parser := &priceFormulaParser{tokens: tokens}
	root, err := parser.parse()
	if err != nil {
		return compiledPriceFormula{}, err
	}
	variables := map[string]bool{}
	collectFormulaVariables(root, variables)
	if len(variables) > formulaMaxVariables {
		return compiledPriceFormula{}, fmt.Errorf("formula references more than %d variables", formulaMaxVariables)
	}
	ordered := make([]string, 0, len(variables))
	for variable := range variables {
		if !allowedVariables[variable] {
			return compiledPriceFormula{}, fmt.Errorf("formula variable %s is not verified for this Operation", variable)
		}
		ordered = append(ordered, variable)
	}
	sort.Strings(ordered)
	canonical := canonicalFormulaNode(root)
	digest := sha256.Sum256([]byte(priceFormulaLanguage + "\n" + canonical))
	return compiledPriceFormula{root: root, variables: ordered, canonical: canonical, sha256: hex.EncodeToString(digest[:])}, nil
}

func numericInterval(minimum, maximum *big.Rat) formulaInterval {
	return formulaInterval{number: true, min: new(big.Rat).Set(minimum), max: new(big.Rat).Set(maximum)}
}

func intervalCorners(left, right formulaInterval, operation func(*big.Rat, *big.Rat) *big.Rat) (*big.Rat, *big.Rat) {
	values := []*big.Rat{
		operation(left.min, right.min), operation(left.min, right.max),
		operation(left.max, right.min), operation(left.max, right.max),
	}
	minimum, maximum := new(big.Rat).Set(values[0]), new(big.Rat).Set(values[0])
	for _, value := range values[1:] {
		if value.Cmp(minimum) < 0 {
			minimum.Set(value)
		}
		if value.Cmp(maximum) > 0 {
			maximum.Set(value)
		}
	}
	return minimum, maximum
}

func safeFormulaInterval(node *priceFormulaNode, bounds map[string]int64) (formulaInterval, error) {
	switch node.kind {
	case "number":
		value, ok := new(big.Rat).SetString(node.value)
		if !ok {
			return formulaInterval{}, errors.New("invalid numeric literal")
		}
		return numericInterval(value, value), nil
	case "variable":
		maximum, ok := bounds[node.value]
		if !ok || maximum < 1 {
			return formulaInterval{}, fmt.Errorf("metering dimension %s requires a positive maximumPerInvocation", node.value)
		}
		return numericInterval(new(big.Rat), new(big.Rat).SetInt64(maximum)), nil
	case "unary":
		child, err := safeFormulaInterval(node.args[0], bounds)
		if err != nil {
			return formulaInterval{}, err
		}
		if child.number {
			return formulaInterval{}, errors.New("not requires a boolean condition")
		}
		return formulaInterval{}, nil
	case "binary":
		left, err := safeFormulaInterval(node.args[0], bounds)
		if err != nil {
			return formulaInterval{}, err
		}
		right, err := safeFormulaInterval(node.args[1], bounds)
		if err != nil {
			return formulaInterval{}, err
		}
		if node.value == "and" || node.value == "or" {
			if left.number || right.number {
				return formulaInterval{}, fmt.Errorf("%s requires boolean operands", node.value)
			}
			return formulaInterval{}, nil
		}
		if strings.Contains("< <= > >= == !=", node.value) {
			if !left.number || !right.number {
				return formulaInterval{}, errors.New("comparisons require numeric operands")
			}
			return formulaInterval{}, nil
		}
		if !left.number || !right.number {
			return formulaInterval{}, fmt.Errorf("operator %s requires numeric operands", node.value)
		}
		switch node.value {
		case "+":
			return numericInterval(new(big.Rat).Add(left.min, right.min), new(big.Rat).Add(left.max, right.max)), nil
		case "-":
			return numericInterval(new(big.Rat).Sub(left.min, right.max), new(big.Rat).Sub(left.max, right.min)), nil
		case "*":
			minimum, maximum := intervalCorners(left, right, func(a, b *big.Rat) *big.Rat { return new(big.Rat).Mul(a, b) })
			return numericInterval(minimum, maximum), nil
		case "/":
			if node.args[1].kind != "number" || right.min.Sign() <= 0 || right.min.Cmp(right.max) != 0 {
				return formulaInterval{}, errors.New("formula divisors must be positive numeric constants")
			}
			return numericInterval(new(big.Rat).Quo(left.min, right.min), new(big.Rat).Quo(left.max, right.max)), nil
		}
	case "call":
		if node.value == "if" {
			condition, err := safeFormulaInterval(node.args[0], bounds)
			if err != nil {
				return formulaInterval{}, err
			}
			if condition.number {
				return formulaInterval{}, errors.New("if requires a boolean condition")
			}
			yes, err := safeFormulaInterval(node.args[1], bounds)
			if err != nil {
				return formulaInterval{}, err
			}
			no, err := safeFormulaInterval(node.args[2], bounds)
			if err != nil {
				return formulaInterval{}, err
			}
			if !yes.number || !no.number {
				return formulaInterval{}, errors.New("if branches must produce numbers")
			}
			minimum, maximum := new(big.Rat).Set(yes.min), new(big.Rat).Set(yes.max)
			if no.min.Cmp(minimum) < 0 {
				minimum.Set(no.min)
			}
			if no.max.Cmp(maximum) > 0 {
				maximum.Set(no.max)
			}
			return numericInterval(minimum, maximum), nil
		}
		left, err := safeFormulaInterval(node.args[0], bounds)
		if err != nil {
			return formulaInterval{}, err
		}
		if !left.number {
			return formulaInterval{}, fmt.Errorf("%s requires numeric arguments", node.value)
		}
		if node.value == "ceil" || node.value == "floor" {
			// Rounding is monotone, so rounding the interval endpoints is safe.
			round := func(value *big.Rat, ceil bool) *big.Rat {
				quotient, remainder := new(big.Int).QuoRem(value.Num(), value.Denom(), new(big.Int))
				if ceil && remainder.Sign() > 0 {
					quotient.Add(quotient, big.NewInt(1))
				}
				if !ceil && remainder.Sign() < 0 {
					quotient.Sub(quotient, big.NewInt(1))
				}
				return new(big.Rat).SetInt(quotient)
			}
			return numericInterval(round(left.min, node.value == "ceil"), round(left.max, node.value == "ceil")), nil
		}
		right, err := safeFormulaInterval(node.args[1], bounds)
		if err != nil {
			return formulaInterval{}, err
		}
		if !right.number {
			return formulaInterval{}, fmt.Errorf("%s requires numeric arguments", node.value)
		}
		if node.value == "min" {
			minimum := left.min
			if right.min.Cmp(minimum) < 0 {
				minimum = right.min
			}
			maximum := left.max
			if right.max.Cmp(maximum) < 0 {
				maximum = right.max
			}
			return numericInterval(minimum, maximum), nil
		}
		if node.value == "max" {
			minimum := left.min
			if right.min.Cmp(minimum) > 0 {
				minimum = right.min
			}
			maximum := left.max
			if right.max.Cmp(maximum) > 0 {
				maximum = right.max
			}
			return numericInterval(minimum, maximum), nil
		}
	}
	return formulaInterval{}, errors.New("formula cannot be statically verified")
}

func validateSafeChargeFormula(compiled compiledPriceFormula, bounds map[string]int64) error {
	result, err := safeFormulaInterval(compiled.root, bounds)
	if err != nil {
		return err
	}
	if !result.number {
		return errors.New("chargeFormula must produce a numeric amount")
	}
	if result.min.Sign() < 0 {
		return errors.New("chargeFormula cannot be proven non-negative for all declared inputs")
	}
	return nil
}

func numberValue(value *big.Rat) formulaValue { return formulaValue{number: value} }
func boolValue(value bool) formulaValue       { return formulaValue{boolean: &value} }
func requireNumber(value formulaValue) (*big.Rat, error) {
	if value.number == nil {
		return nil, errors.New("formula expected a number")
	}
	return value.number, nil
}
func requireBool(value formulaValue) (bool, error) {
	if value.boolean == nil {
		return false, errors.New("formula expected a condition")
	}
	return *value.boolean, nil
}

func evaluateFormulaNode(node *priceFormulaNode, variables map[string]int64, steps *int) (formulaValue, error) {
	(*steps)++
	if *steps > formulaMaxSteps {
		return formulaValue{}, errors.New("formula evaluation step limit exceeded")
	}
	switch node.kind {
	case "number":
		value, _ := new(big.Rat).SetString(node.value)
		return numberValue(value), nil
	case "variable":
		value, ok := variables[node.value]
		if !ok || value < 0 {
			return formulaValue{}, fmt.Errorf("formula variable %s requires a non-negative integer", node.value)
		}
		return numberValue(new(big.Rat).SetInt64(value)), nil
	case "unary":
		child, err := evaluateFormulaNode(node.args[0], variables, steps)
		if err != nil {
			return formulaValue{}, err
		}
		value, err := requireBool(child)
		if err != nil {
			return formulaValue{}, err
		}
		return boolValue(!value), nil
	case "binary":
		left, err := evaluateFormulaNode(node.args[0], variables, steps)
		if err != nil {
			return formulaValue{}, err
		}
		if node.value == "and" || node.value == "or" {
			leftBool, err := requireBool(left)
			if err != nil {
				return formulaValue{}, err
			}
			if node.value == "and" && !leftBool {
				return boolValue(false), nil
			}
			if node.value == "or" && leftBool {
				return boolValue(true), nil
			}
			right, err := evaluateFormulaNode(node.args[1], variables, steps)
			if err != nil {
				return formulaValue{}, err
			}
			rightBool, err := requireBool(right)
			if err != nil {
				return formulaValue{}, err
			}
			return boolValue(rightBool), nil
		}
		right, err := evaluateFormulaNode(node.args[1], variables, steps)
		if err != nil {
			return formulaValue{}, err
		}
		leftNumber, err := requireNumber(left)
		if err != nil {
			return formulaValue{}, err
		}
		rightNumber, err := requireNumber(right)
		if err != nil {
			return formulaValue{}, err
		}
		switch node.value {
		case "+":
			return numberValue(new(big.Rat).Add(leftNumber, rightNumber)), nil
		case "-":
			return numberValue(new(big.Rat).Sub(leftNumber, rightNumber)), nil
		case "*":
			return numberValue(new(big.Rat).Mul(leftNumber, rightNumber)), nil
		case "/":
			if rightNumber.Sign() == 0 {
				return formulaValue{}, errors.New("division by zero is not allowed")
			}
			return numberValue(new(big.Rat).Quo(leftNumber, rightNumber)), nil
		case "<":
			return boolValue(leftNumber.Cmp(rightNumber) < 0), nil
		case "<=":
			return boolValue(leftNumber.Cmp(rightNumber) <= 0), nil
		case ">":
			return boolValue(leftNumber.Cmp(rightNumber) > 0), nil
		case ">=":
			return boolValue(leftNumber.Cmp(rightNumber) >= 0), nil
		case "==":
			return boolValue(leftNumber.Cmp(rightNumber) == 0), nil
		case "!=":
			return boolValue(leftNumber.Cmp(rightNumber) != 0), nil
		}
	case "call":
		if node.value == "if" {
			condition, err := evaluateFormulaNode(node.args[0], variables, steps)
			if err != nil {
				return formulaValue{}, err
			}
			yes, err := requireBool(condition)
			if err != nil {
				return formulaValue{}, err
			}
			branch := node.args[2]
			if yes {
				branch = node.args[1]
			}
			return evaluateFormulaNode(branch, variables, steps)
		}
		values := make([]*big.Rat, len(node.args))
		for index, child := range node.args {
			value, err := evaluateFormulaNode(child, variables, steps)
			if err != nil {
				return formulaValue{}, err
			}
			number, err := requireNumber(value)
			if err != nil {
				return formulaValue{}, err
			}
			values[index] = number
		}
		switch node.value {
		case "min":
			if values[0].Cmp(values[1]) <= 0 {
				return numberValue(values[0]), nil
			}
			return numberValue(values[1]), nil
		case "max":
			if values[0].Cmp(values[1]) >= 0 {
				return numberValue(values[0]), nil
			}
			return numberValue(values[1]), nil
		case "ceil", "floor":
			quotient, remainder := new(big.Int).QuoRem(values[0].Num(), values[0].Denom(), new(big.Int))
			if node.value == "ceil" && remainder.Sign() > 0 {
				quotient.Add(quotient, big.NewInt(1))
			}
			if node.value == "floor" && remainder.Sign() < 0 {
				quotient.Sub(quotient, big.NewInt(1))
			}
			return numberValue(new(big.Rat).SetInt(quotient)), nil
		}
	}
	return formulaValue{}, errors.New("invalid formula AST")
}

func evaluateCompiledPriceFormula(compiled compiledPriceFormula, variables map[string]int64, maximumAtomic int64) (int64, int64, error) {
	steps := 0
	value, err := evaluateFormulaNode(compiled.root, variables, &steps)
	if err != nil {
		return 0, 0, err
	}
	amount, err := requireNumber(value)
	if err != nil {
		return 0, 0, err
	}
	if amount.Sign() < 0 {
		return 0, 0, errors.New("formula result cannot be negative")
	}
	atomicRat := new(big.Rat).Mul(amount, big.NewRat(1_000_000, 1))
	atomic, remainder := new(big.Int).QuoRem(atomicRat.Num(), atomicRat.Denom(), new(big.Int))
	if remainder.Sign() > 0 {
		atomic.Add(atomic, big.NewInt(1))
	}
	if !atomic.IsInt64() {
		return 0, 0, errors.New("formula result exceeds supported money range")
	}
	unbounded := atomic.Int64()
	billed := unbounded
	if billed > maximumAtomic {
		billed = maximumAtomic
	}
	return unbounded, billed, nil
}
