import { describe, expect, it } from 'vitest'
import { EngineError, acNameplate } from '@nec-assistant/engine'

/**
 * Article 440 from either kind of plate. Every number below is hand-derived:
 *   MCA  = max(1.25 × rated, max)                        (440.32; the max is the running load)
 *   MOCP = largest standard ≤ 1.75 × rated               (440.22(A))
 *          → ≤ 2.25 × rated if that cannot carry the max (starting allowance)
 *          → 15 A when 1.75 × rated < 15                 (440.22(A) Exception)
 */
describe('acNameplate — U.S.-market plate (MCA/MOCP marked)', () => {
  it('passes marked MCA/MOCP through untouched and derives nothing', () => {
    const r = acNameplate({ ratedA: 0, maxA: 0, mcaA: 24, mocpA: 40 })
    expect(r.mcaA).toBe(24)
    expect(r.mocpA).toBe(40)
    expect(r.mcaDerived).toBe(false)
    expect(r.mocpDerived).toBe(false)
    expect(r.ratedA).toBe(19.2) // 24 ÷ 1.25, only informational here
    expect(r.assumptions).toEqual([])
    expect(r.citations).toContain('nec2026.s440_4_b')
    expect(r.citations).not.toContain('nec2026.s440_32')
  })

  it('MCA marked but no MOCP: rated inferred as MCA ÷ 1.25, MOCP derived from it', () => {
    // 10 ÷ 1.25 = 8 A rated → 1.75 × 8 = 14 < 15 → 15 A by the Exception.
    const r = acNameplate({ mcaA: 10 })
    expect(r.ratedA).toBe(8)
    expect(r.mcaA).toBe(10)
    expect(r.mocpA).toBe(15)
    expect(r.minimum15Applied).toBe(true)
    expect(r.mocpDerived).toBe(true)
    expect(r.assumptions.map((a) => a.key)).toEqual(['ac-nameplate-derived'])
  })
})

describe('acNameplate — Latin-market plate (corriente nominal / máxima)', () => {
  it('Samsung AR40H12D0BMX, 115 V: 11.8 A nominal, 17.5 A max → MCA 17.5, MOCP 20', () => {
    const r = acNameplate({ ratedA: 11.8, maxA: 17.5, mcaA: 0, mocpA: 0 })
    expect(r.mcaA).toBe(17.5) // max(14.75, 17.5)
    expect(r.mocpA).toBe(20) // 1.75 × 11.8 = 20.65 → 20, and 20 ≥ 17.5
    expect(r.startingAllowanceApplied).toBe(false)
    expect(r.minimum15Applied).toBe(false)
    expect(r.citations).toEqual(
      expect.arrayContaining(['nec2026.s440_6', 'nec2026.s440_32', 'nec2026.s440_22', 'nec2026.s240_6_a']),
    )
    // No duplicate citation keys leak out of the derivation.
    expect(new Set(r.citations).size).toBe(r.citations.length)
  })

  it('125 % of the rated current governs the MCA when it exceeds the marked max', () => {
    // 1.25 × 10 = 12.5 > 12
    const r = acNameplate({ ratedA: 10, maxA: 12 })
    expect(r.mcaA).toBe(12.5)
  })

  it('no marked max: MCA is 125 % of rated, MOCP within 175 %', () => {
    // 1.25 × 12 = 15; 1.75 × 12 = 21 → 20 (≥ 12 rated)
    const r = acNameplate({ ratedA: 12 })
    expect(r.mcaA).toBe(15)
    expect(r.maxA).toBeUndefined()
    expect(r.mocpA).toBe(20)
  })

  it('175 % cannot carry the max → the 225 % starting allowance is used', () => {
    // rated 10, max 19: 1.75 × 10 = 17.5 → 15 < 19; 2.25 × 10 = 22.5 → 20 ≥ 19
    const r = acNameplate({ ratedA: 10, maxA: 19 })
    expect(r.mocpA).toBe(20)
    expect(r.startingAllowanceApplied).toBe(true)
    expect(r.mcaA).toBe(19)
  })

  it('even 225 % below the max: keeps the 225 % pick (standardBreaker will flag it) ', () => {
    // rated 8, max 22: 1.75 × 8 = 14 → 15 A by the Exception path (c175 undefined)
    const r = acNameplate({ ratedA: 8, maxA: 22 })
    expect(r.mocpA).toBe(15)
    expect(r.minimum15Applied).toBe(true)
    expect(r.mcaA).toBe(22)
  })

  it('small unit: 175 % under 15 A → 15 A by the 440.22(A) Exception', () => {
    // 7.5 A: 1.75 × 7.5 = 13.125 → nothing ≤ 13.125 on the ladder
    const r = acNameplate({ ratedA: 7.5, maxA: 11 })
    expect(r.mocpA).toBe(15)
    expect(r.minimum15Applied).toBe(true)
    expect(r.startingAllowanceApplied).toBe(false)
  })

  it('a plate with neither MCA nor rated current cannot be sized — bilingual input error', () => {
    expect(() => acNameplate({ ratedA: 0, maxA: 17.5, mcaA: 0, mocpA: 0 })).toThrow(EngineError)
    try {
      acNameplate({})
    } catch (e) {
      expect((e as EngineError).kind).toBe('input')
      expect((e as EngineError).es).toContain('corriente nominal')
    }
  })
})
