import { describe, expect, it } from 'vitest'
import { acMinisplitTemplate } from '@nec-assistant/data'
import { presetSelection, urlStateToRunInput } from '../src/lib/template-url'

/**
 * URL back-compat contract: mini-split links shared before the generic runner
 * (short keys d/mca/mocp/l/loc/amb/p/cd/bd/bc/w) must keep producing the same
 * runTemplate input. The old runner's `.withDefault(...)` values now live as
 * template defaults, so omitted keys are simply absent here and filled by
 * resolveTemplateState.
 */

describe('urlStateToRunInput (mini-split back-compat)', () => {
  it('resolves an old-format preset URL exactly as the previous runner did', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, {
      d: 'ac-36k',
      l: '15',
      loc: 'exterior',
      cd: 'emt',
      bd: 'dobladora',
    })
    expect(input.answers['device']).toEqual({
      id: 'ac-36k',
      voltage: 230,
      ratedA: 0,
      maxA: 0,
      mcaA: 24,
      mocpA: 40,
      typicalW: 3400,
    })
    expect(input.answers['runLengthM']).toBe(15)
    expect(input.answers['location']).toBe('exterior')
    expect(input.answers['ambientC']).toBeUndefined() // untouched → template default (40 outdoors)
    expect(input.options['conduitType']).toBe('emt')
    expect(input.options['bends']).toBe('dobladora')
    expect(input.options['bendCount']).toBeUndefined()
  })

  it('manual nameplate entry: d=manual + mca/mocp keys (a U.S.-market plate)', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, { d: 'manual', mca: '22', mocp: '35' })
    expect(input.answers['device']).toEqual({
      voltage: 230,
      ratedA: 8,
      maxA: 12,
      mcaA: 22,
      mocpA: 35,
      typicalW: 1150,
    })
  })

  it('manual Latin-market plate: pv/ia/im keys, MCA/MOCP left at 0 (= not marked)', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, { d: 'manual', pv: '115', ia: '11.8', im: '17.5' })
    expect(input.answers['device']).toEqual({
      voltage: 115,
      ratedA: 11.8,
      maxA: 17.5,
      mcaA: 0,
      mocpA: 0,
      typicalW: 1150,
    })
  })

  it('manual entry falls back to field defaults when keys are absent', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, { d: 'manual' })
    expect(input.answers['device']).toEqual({
      voltage: 230,
      ratedA: 8,
      maxA: 12,
      mcaA: 0,
      mocpA: 0,
      typicalW: 1150,
    })
  })

  it('an unknown preset id falls back to the template default preset', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, { d: 'no-such-unit' })
    expect((input.answers['device'] as { id: string }).id).toBe('ac-12k')
    expect(presetSelection(acMinisplitTemplate, 'device', { d: 'no-such-unit' })).toBe('ac-12k')
  })

  it('invalid choice and number values are omitted (template defaults apply)', () => {
    const input = urlStateToRunInput(acMinisplitTemplate, {
      loc: 'bogus',
      l: 'NaN',
      cd: 'garden-hose',
    })
    expect(input.answers['location']).toBeUndefined()
    expect(input.answers['runLengthM']).toBeUndefined()
    expect(input.options['conduitType']).toBeUndefined()
  })
})
