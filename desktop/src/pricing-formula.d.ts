export type FormulaEvaluation = { unboundedAtomic: number; billedAtomic: number }
export type CompiledPriceFormula = { canonical: string; formatted: string; variables: string[]; evaluate(usage: Record<string, number>, maximumAtomic: number): FormulaEvaluation }
export function compilePriceFormula(expression: string, allowedVariables: string[]): CompiledPriceFormula
