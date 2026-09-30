import { standardBreakers } from '@nec-assistant/data'
import { EngineError, mergeCitations, type Assumption, type WithProvenance } from './types.js'

/**
 * Turn whatever an A/C nameplate says into the two numbers Article 440 sizes
 * from: MCA (conductor) and MOCP (device).
 *
 * A unit sold in the United States carries both, marked per 440.4(B). A unit
 * sold in Latin America usually carries neither: its plate (IEC-style) gives
 * «corriente nominal» (the rated-load current, 440.6(A)) and «corriente
 * máxima» (the highest sustained running current, which an inverter reaches
 * at full capacity). This function accepts either plate and derives what is
 * missing, so the template never has to ask the user to compute MCA/MOCP by
 * hand — the whole reason those plates stalled the flow before.
 *
 * Derivation when MCA/MOCP are not marked:
 *  - MCA = max(125 % × rated-load current (440.32), corriente máxima). The
 *    maximum is treated as the real running load the conductor must carry,
 *    NOT as a branch-circuit selection current (which a plate marks by that
 *    name); reading it as BCSC would add another 25 % on top of a number that
 *    is already the ceiling.
 *  - MOCP = largest standard rating ≤ 175 % × rated-load current (440.22(A)),
 *    raised to ≤ 225 % only if 175 % cannot carry the corriente máxima, and
 *    never below 15 A (440.22(A) Exception).
 *
 * A value of 0 (or absent) means «not on the plate». When only the MCA is
 * marked, the rated-load current is inferred as MCA ÷ 1.25 so a MOCP can
 * still be derived.
 */
export interface AcNameplateInput {
  /** Rated-load current («corriente nominal»), A. 0/absent = not marked. */
  ratedA?: number
  /** Maximum running current («corriente máxima»), A. 0/absent = not marked. */
  maxA?: number
  /** Marked MCA, A. 0/absent = not marked. */
  mcaA?: number
  /** Marked MOCP, A. 0/absent = not marked. */
  mocpA?: number
}

export interface AcNameplateResult extends WithProvenance {
  /** Minimum circuit ampacity the conductor is sized from. */
  mcaA: number
  /** Maximum overcurrent protection the device is sized from. */
  mocpA: number
  /** Rated-load current used: marked, or MCA ÷ 1.25 when only the MCA was marked. */
  ratedA: number
  /** Marked maximum running current, when the plate gave one. */
  maxA?: number
  /** True when the MCA was derived (not marked). */
  mcaDerived: boolean
  /** True when the MOCP was derived (not marked). */
  mocpDerived: boolean
  /** Derived MOCP: the 175 % pick could not carry the maximum, so the 225 % allowance was used. */
  startingAllowanceApplied: boolean
  /** Derived MOCP: 175 % of the rated current fell under 15 A, so the 15 A exception set it. */
  minimum15Applied: boolean
}

const ASSUME_NAMEPLATE_DERIVED: Assumption = {
  key: 'ac-nameplate-derived',
  en: 'The nameplate does not mark MCA/MOCP (a 440.4(B) marking required in the United States, but not on units sold in Latin America), so they were derived from it: MCA = the greater of 125 % of the rated current (440.32) and the marked maximum current; MOCP = the largest standard rating within 175 % of the rated current (440.22(A)), raised to within 225 % only if the 175 % pick cannot carry the maximum current, and never below 15 A. The marked maximum is read as the sustained running load, not as a branch-circuit selection current.',
  es: 'La placa no trae MCA/MOCP (un marcado de 440.4(B) obligatorio en Estados Unidos, pero no en los equipos que se venden en Latinoamérica), así que se derivaron de ella: MCA = el mayor entre el 125 % de la corriente nominal (440.32) y la corriente máxima de placa; MOCP = el valor estándar más grande dentro del 175 % de la corriente nominal (440.22(A)), subido hasta el 225 % solo si el de 175 % no aguanta la corriente máxima, y nunca menor de 15 A. La corriente máxima se toma como la carga sostenida real, no como una «branch-circuit selection current».',
  citations: ['nec2026.s440_6', 'nec2026.s440_32', 'nec2026.s440_22'],
}

const marked = (value: number | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0

const round2 = (n: number): number => Number(n.toFixed(2))

function largestStandardAtOrBelow(amps: number): number | undefined {
  return [...standardBreakers.ratings].reverse().find((r) => r <= amps)
}

export function acNameplate(input: AcNameplateInput): AcNameplateResult {
  const hasMca = marked(input.mcaA)
  const hasMocp = marked(input.mocpA)
  const hasRated = marked(input.ratedA)
  const hasMax = marked(input.maxA)

  if (!hasMca && !hasRated) {
    throw new EngineError(
      'The nameplate gives neither an MCA nor a rated current — nothing to size from',
      'La placa no da ni MCA ni corriente nominal — no hay de dónde calcular',
    )
  }

  // 440.6(A): the rated-load current marked on the nameplate is the basis.
  // A U.S. plate that marks MCA but no rated current still lets us back it out.
  const ratedA: number = hasRated ? input.ratedA! : round2(input.mcaA! / 1.25)
  const maxA: number | undefined = hasMax ? input.maxA! : undefined

  const citations: AcNameplateResult['citations'] = ['nec2026.s440_4_b']
  const assumptions: Assumption[] = []

  let mcaA: number
  let mcaDerived = false
  if (hasMca) {
    mcaA = input.mcaA!
  } else {
    mcaA = round2(Math.max(ratedA * 1.25, maxA ?? 0))
    mcaDerived = true
    citations.push('nec2026.s440_6', 'nec2026.s440_32')
  }

  let mocpA: number
  let mocpDerived = false
  let startingAllowanceApplied = false
  let minimum15Applied = false
  if (hasMocp) {
    mocpA = input.mocpA!
    citations.push('nec2026.s440_22')
  } else {
    mocpDerived = true
    citations.push('nec2026.s440_6', 'nec2026.s440_22', 'nec2026.s240_6_a')
    // What the device must carry when the unit runs flat out. With no marked
    // maximum, the rated current is all the plate says it draws.
    const needA = Math.max(ratedA, maxA ?? 0)
    const c175 = largestStandardAtOrBelow(ratedA * 1.75)
    if (c175 === undefined) {
      // 175 % of the rated current is under the smallest standard rating:
      // 440.22(A) Exception — the device need not be rated below 15 A.
      mocpA = standardBreakers.ratings[0]!
      minimum15Applied = true
    } else if (c175 >= needA) {
      mocpA = c175
    } else {
      // 440.22(A): where 175 % is not enough for starting, up to 225 %. If even
      // that sits under the maximum, keep it — `standardBreaker` marks a MOCP
      // below the MCA as `mocp-below-required` rather than hiding it here.
      const c225 = largestStandardAtOrBelow(ratedA * 2.25) ?? c175
      mocpA = c225
      startingAllowanceApplied = c225 !== c175
    }
  }

  if (mcaDerived || mocpDerived) assumptions.push(ASSUME_NAMEPLATE_DERIVED)

  return {
    mcaA,
    mocpA,
    ratedA,
    ...(maxA !== undefined ? { maxA } : {}),
    mcaDerived,
    mocpDerived,
    startingAllowanceApplied,
    minimum15Applied,
    citations: mergeCitations(citations),
    assumptions,
    deviations: [],
  }
}
