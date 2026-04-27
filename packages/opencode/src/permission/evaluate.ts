import { Wildcard } from "@/util"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  for (let rulesetIndex = rulesets.length - 1; rulesetIndex >= 0; rulesetIndex--) {
    const ruleset = rulesets[rulesetIndex]
    for (let ruleIndex = ruleset.length - 1; ruleIndex >= 0; ruleIndex--) {
      const rule = ruleset[ruleIndex]
      if (Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) return rule
    }
  }
  return { action: "ask", permission, pattern: "*" }
}
