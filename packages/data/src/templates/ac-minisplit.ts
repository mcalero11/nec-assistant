import type { JobTemplate, ValueSpec } from '../catalog/types.js'

/**
 * Wet-location rule (PRD US-1): outdoor routing switches to a wet-rated 90 °C
 * insulation. A roof run counts as wet — «sobre el techo» is rain and sun, and
 * an entretecho run usually reaches the roof through the same exposed stretch,
 * so the wet-rated conductor is the honest default for both.
 */
const INSULATION_BY_LOCATION: ValueSpec = {
  $cond: {
    if: { ref: 'answers.location', in: ['exterior', 'techo'] },
    then: 'THWN-2',
    else: 'THHN',
  },
}

const WIRE_TABLE = {
  '14': 'thhn-cu-14',
  '12': 'thhn-cu-12',
  '10': 'thhn-cu-10',
  '8': 'thhn-cu-8',
  '6': 'thhn-cu-6',
}

/**
 * Seed template #1: aire acondicionado mini-split (circuit + disconnect + whip).
 * Declarative data interpreted by @nec-assistant/engine runTemplate — the engine-call
 * graph chains acNameplate → sizeCircuit → egcSize → sizeConduit exactly like the
 * composition idiom documented in conduit-fill.ts.
 *
 * Two markets, one flow. A unit sold in the United States runs on 208–230 V
 * (2-pole breaker) and its plate marks MCA/MOCP; a unit sold in Latin America is
 * often 115 V (1-pole) and its plate marks corriente nominal and corriente
 * máxima instead. The nameplate call derives whichever pair is missing, and the
 * plate voltage picks the pole count, the panel-voltage default and the breaker
 * item — so the same template prices both.
 */
export const acMinisplitTemplate: JobTemplate = {
  id: 'ac-minisplit',
  version: 1,
  name: {
    es: 'Aire acondicionado mini-split',
    en: 'Mini-split air conditioner',
  },
  synonyms: ['aire', 'ac', 'a/c', 'minisplit', 'mini split', 'split', 'aire acondicionado'],

  questions: [
    {
      id: 'device',
      type: 'preset',
      catalog: 'ac-presets',
      default: 'ac-12k',
      // answers.device.* ← preset.values (generic-runner contract). Every plate
      // field is always present; 0 means «the plate does not mark this».
      sets: {
        voltage: 'voltage',
        ratedA: 'ratedA',
        maxA: 'maxA',
        mcaA: 'mcaA',
        mocpA: 'mocpA',
        typicalW: 'typicalW',
      },
      manualFields: [
        {
          // 115 V (1 polo) or 208–230 V (2 polos): the plate says which. Anything
          // under 160 V is read as the 120 V branch (see the `supply` derived value).
          id: 'voltage',
          label: { es: 'Voltaje de placa (V)', en: 'Nameplate voltage (V)' },
          default: 230,
          min: 100,
          max: 250,
          step: 1,
          unit: 'V',
          urlKey: 'pv',
        },
        {
          // Watts is how these units are specified locally, so it is an entry
          // field, not only a preset value. It is shown and quoted but is NOT
          // what the conductor is sized from — that is the MCA below.
          id: 'typicalW',
          label: { es: 'Consumo de placa (W)', en: 'Nameplate power draw (W)' },
          default: 1150,
          min: 200,
          max: 8000,
          step: 50,
          unit: 'W',
          urlKey: 'pw',
        },
        {
          // «Corriente nominal» — the rated-load current every plate carries
          // (440.6(A)). Defaults sketch a 230 V 12k inverter; on a Latin-market
          // plate this pair is all there is, and MCA/MOCP stay at 0.
          id: 'ratedA',
          label: { es: 'Corriente nominal (A)', en: 'Rated current (A)' },
          default: 8,
          min: 0,
          max: 60,
          step: 0.1,
          unit: 'A',
          urlKey: 'ia',
        },
        {
          id: 'maxA',
          label: { es: 'Corriente máxima (A) — 0 si no aparece', en: 'Max current (A) — 0 if not marked' },
          default: 12,
          min: 0,
          max: 80,
          step: 0.1,
          unit: 'A',
          urlKey: 'im',
        },
        {
          // Marked MCA/MOCP (440.4(B)) win over the derivation when present.
          id: 'mcaA',
          label: { es: 'MCA de placa (A) — 0 si no aparece', en: 'Nameplate MCA (A) — 0 if not marked' },
          default: 0,
          min: 0,
          max: 60,
          step: 0.1,
          unit: 'A',
          urlKey: 'mca',
        },
        {
          id: 'mocpA',
          label: { es: 'MOCP de placa (A) — 0 si no aparece', en: 'Nameplate MOCP (A) — 0 if not marked' },
          default: 0,
          min: 0,
          // 60 A, not 90: above that the disconnect table (30/60 A) and the
          // 2-pole breakers stocked locally run out, and a residential
          // mini-split needing more than 60 A is outside this template.
          max: 60,
          step: 5,
          unit: 'A',
          urlKey: 'mocp',
        },
      ],
      presetNote: {
        es: 'Valores típicos de placa; verifique la placa de SU equipo. Si su placa trae corriente nominal y máxima en vez de MCA/MOCP, entre esas y deje MCA/MOCP en 0.',
        en: 'Typical nameplate values; verify YOUR unit’s plate. If the plate marks rated and max current instead of MCA/MOCP, enter those and leave MCA/MOCP at 0.',
      },
      label: { es: 'Capacidad del equipo (BTU)', en: 'Unit capacity (BTU)' },
      urlKey: 'd',
      termId: 'btu',
    },
    {
      id: 'runLengthM',
      type: 'number',
      unit: 'm',
      min: 1,
      max: 60,
      step: 1,
      default: 10,
      label: { es: 'Distancia del panel al equipo (un solo sentido)', en: 'One-way run length from panel' },
      urlKey: 'l',
    },
    {
      // The plate says 208–230 V; the panel here measures nearer 220 than 240,
      // and a lower voltage means a HIGHER drop percentage, so 240 was the
      // optimistic reading. Default 220 (user, 2026-08-31). A 115 V unit hangs
      // off one leg of that same service, so its default is half: 110.
      id: 'systemVoltage',
      type: 'number',
      unit: 'V',
      min: 100,
      max: 250,
      step: 1,
      default: {
        $cond: { if: { ref: 'answers.device.voltage', lt: 160 }, then: 110, else: 220 },
      },
      label: { es: 'Voltaje medido en el tablero', en: 'Voltage measured at the panel' },
      urlKey: 'v',
    },
    {
      id: 'location',
      type: 'choice',
      default: 'exterior',
      choices: [
        { value: 'interior', label: { es: 'Interior (seco)', en: 'Indoor (dry)' } },
        { value: 'exterior', label: { es: 'Exterior (intemperie)', en: 'Outdoor (wet)' } },
        {
          value: 'techo',
          label: { es: 'Sobre el techo / entretecho', en: 'On the roof / in the roof space' },
        },
      ],
      label: { es: 'Recorrido de la tubería', en: 'Conduit routing' },
      urlKey: 'loc',
    },
    {
      // El Salvador runs hot: 30°C (the NEC table basis) undersizes real installs.
      // Default depends on the location answer above (questions resolve in order).
      // Ceiling raised to 65°C (user, 2026-08-31): a condenser and its run sitting
      // on a roof or in an entretecho at midday go far past the old 50°C cap, and
      // capping the field there quietly under-derated the very worst case.
      id: 'ambientC',
      type: 'number',
      unit: '°C',
      min: 25,
      max: 65,
      step: 1,
      default: {
        $cond: {
          if: { ref: 'answers.location', eq: 'techo' },
          then: 55,
          else: {
            $cond: {
              if: { ref: 'answers.location', eq: 'exterior' },
              then: 40,
              else: 35,
            },
          },
        },
      },
      label: { es: 'Temperatura donde pasa el cable', en: 'Ambient temperature along the run' },
      urlKey: 'amb',
      termId: 'temperaturaAmbiente',
    },
    {
      id: 'panelSlots',
      type: 'choice',
      default: '2polos',
      choices: [
        // Value kept as '2polos' for URL back-compat; it now just means «yes».
        { value: '2polos', label: { es: 'Sí, hay espacio', en: 'Yes, there is space' } },
        { value: 'ninguno', label: { es: 'No hay espacio', en: 'No space' } },
      ],
      label: { es: '¿Hay espacio en el panel para el térmico nuevo?', en: 'Panel space for the new breaker?' },
      urlKey: 'p',
    },
  ],

  options: [
    {
      id: 'conduitType',
      type: 'choice',
      default: 'emt',
      choices: [
        { value: 'emt', label: { es: 'Tubo EMT', en: 'EMT' }, termId: 'emt' },
        { value: 'pvc', label: { es: 'PVC eléctrico', en: 'Electrical PVC' }, termId: 'pvcElectrico' },
        { value: 'lfnc', label: { es: 'Poliducto (manguera)', en: 'Flexible (LFNC)' }, termId: 'poliducto' },
      ],
      label: { es: 'Tipo de tubería', en: 'Conduit type' },
      urlKey: 'cd',
    },
    {
      // The flexible stretch at the condenser. Coraza LT (LFMC, Art. 350) is the
      // default: outdoors the steel core takes the knocks and the PVC jacket the
      // sun, where poliducto does neither for long.
      id: 'whipType',
      type: 'choice',
      default: 'coraza',
      choices: [
        { value: 'coraza', label: { es: 'Coraza LT (metálica)', en: 'Liquidtight metal (LFMC)' } },
        { value: 'poliducto', label: { es: 'Poliducto (manguera)', en: 'Flexible nonmetallic (LFNC)' } },
      ],
      label: { es: 'Conexión flexible al condensador', en: 'Flexible run to the condenser' },
      urlKey: 'whip',
    },
    {
      id: 'bends',
      type: 'choice',
      default: 'curvas',
      choices: [
        { value: 'curvas', label: { es: 'Comprar curvas', en: 'Buy factory elbows' }, termId: 'curva' },
        { value: 'dobladora', label: { es: 'Doblar con dobladora', en: 'Field-bend with a bender' }, termId: 'dobladora' },
      ],
      disabledWhen: { ref: 'options.conduitType', in: ['lfnc', 'pvc'] },
      label: { es: 'Vueltas del recorrido', en: 'Bends' },
      urlKey: 'bd',
    },
    {
      id: 'bendCount',
      type: 'number',
      min: 0,
      max: 8,
      step: 1,
      default: 3,
      // LFNC bends by hand — neither elbows nor a bender apply.
      disabledWhen: { ref: 'options.conduitType', eq: 'lfnc' },
      label: { es: 'Número de vueltas de 90°', en: 'Number of 90° bends' },
      urlKey: 'bc',
    },
    {
      id: 'wastagePercent',
      type: 'number',
      unit: '%',
      min: 0,
      max: 30,
      step: 5,
      default: 10,
      label: { es: 'Desperdicio', en: 'Wastage' },
      urlKey: 'w',
      termId: 'desperdicio',
    },
  ],

  calls: [
    {
      // Whatever the plate marks (MCA/MOCP, or corriente nominal/máxima) becomes
      // the MCA/MOCP pair Article 440 sizes from. Marked values pass through.
      id: 'nameplate',
      fn: 'acNameplate',
      input: {
        ratedA: { $ref: 'answers.device.ratedA' },
        maxA: { $ref: 'answers.device.maxA' },
        mcaA: { $ref: 'answers.device.mcaA' },
        mocpA: { $ref: 'answers.device.mocpA' },
      },
    },
    {
      id: 'circuit',
      fn: 'sizeCircuit',
      input: {
        loadA: { $ref: 'calls.nameplate.mcaA' },
        // NOT continuous. The nameplate MCA is already 125% of the compressor
        // plus the fan motors (440.32, marked per 440.4(B)) — applying the
        // continuous factor again double-counted it and bought a gauge nobody
        // needed. Conductors size to the MCA, full stop.
        continuous: false,
        // Article 440 governs the device: taken from the nameplate MOCP so it
        // rides through locked-rotor inrush, with 240.4(G) exempting the
        // conductor from the general 240.4 protection rule.
        mocpA: { $ref: 'calls.nameplate.mocpA' },
        lengthM: { $ref: 'answers.runLengthM' },
        systemVoltage: { $ref: 'answers.systemVoltage' },
        material: 'copper',
        insulation: INSULATION_BY_LOCATION,
        ambientC: { $ref: 'answers.ambientC' },
        cccCount: 2,
      },
    },
    {
      id: 'egc',
      fn: 'egcSize',
      input: {
        ocpdA: { $ref: 'calls.circuit.breaker.rating' },
        material: 'copper',
        installedSize: { $ref: 'calls.circuit.conductor.size' },
        requiredSize: { $ref: 'calls.circuit.ampacityMinimumSize' },
      },
    },
    {
      id: 'conduit',
      fn: 'sizeConduit',
      input: {
        conduitType: {
          $cond: {
            if: { ref: 'options.conduitType', eq: 'emt' },
            then: 'EMT',
            else: {
              $cond: {
                if: { ref: 'options.conduitType', eq: 'pvc' },
                then: 'PVC-40',
                else: 'LFNC-B',
              },
            },
          },
        },
        minTradeSize: '1/2',
        conductors: [
          {
            size: { $ref: 'calls.circuit.conductor.size' },
            insulation: INSULATION_BY_LOCATION,
            count: 2,
          },
          {
            size: { $ref: 'calls.egc.size' },
            insulation: INSULATION_BY_LOCATION,
            count: 1,
          },
        ],
      },
    },
  ],

  derived: [
    {
      // 120 V (one hot + neutral, 1-pole breaker) vs 240 V (two hots, 2-pole),
      // from the plate voltage. 160 V splits 100–127 V plates from 200–250 V ones.
      id: 'supply',
      kind: 'value',
      value: {
        $cond: { if: { ref: 'answers.device.voltage', lt: 160 }, then: 120, else: 240 },
      },
      citations: ['nec2026.s440_4_b'],
      label: { es: 'Alimentación', en: 'Supply' },
    },
    {
      id: 'disconnect',
      kind: 'min-rating-at-least',
      ratings: [30, 60],
      atLeast: { $ref: 'calls.circuit.breaker.rating' },
      citations: ['nec2026.s440_14'],
      assumption: {
        key: 'disconnect-nonfused',
        en: 'Non-fused disconnect, at the standard rating equal to or above the breaker; the NEMA 3R box withstands weather.',
        es: 'Desconectador sin fusibles, del valor estándar igual o mayor al térmico; la caja NEMA 3R aguanta intemperie.',
        citations: ['nec2026.s440_14'],
      },
      label: { es: 'Desconectador', en: 'Disconnect' },
    },
  ],

  parameters: [
    {
      id: 'conductor',
      label: { es: 'Calibre (cobre)', en: 'Conductor size (copper)' },
      value: { $ref: 'calls.circuit.conductor.size' },
      unit: 'AWG',
      citationsFrom: 'calls.circuit.conductor',
    },
    {
      id: 'insulation',
      label: { es: 'Aislamiento', en: 'Insulation' },
      value: INSULATION_BY_LOCATION,
      citations: ['nec2026.s110_14_c'],
    },
    {
      id: 'breaker',
      label: { es: 'Térmico', en: 'Breaker' },
      value: { $ref: 'calls.circuit.breaker.rating' },
      unit: 'A',
      citationsFrom: 'calls.circuit.breaker',
    },
    {
      id: 'polos',
      label: { es: 'Polos del térmico', en: 'Breaker poles' },
      value: {
        $cond: { if: { ref: 'derived.supply.value', eq: 120 }, then: '1 polo', else: '2 polos' },
      },
      citationsFrom: 'derived.supply',
    },
    {
      id: 'watts',
      label: {
        es: 'Consumo aproximado del equipo (por verificar)',
        en: 'Approximate power draw (to verify)',
      },
      value: { $ref: 'answers.device.typicalW' },
      unit: 'W',
      citations: ['nec2026.s440_4_b'],
    },
    {
      id: 'mca',
      label: { es: 'Corriente mínima del circuito (MCA) — de placa o derivada', en: 'Minimum circuit ampacity (MCA) — marked or derived' },
      value: { $ref: 'calls.nameplate.mcaA' },
      unit: 'A',
      citationsFrom: 'calls.nameplate',
    },
    {
      id: 'mocp',
      label: { es: 'Protección máxima (MOCP) — de placa o derivada', en: 'Maximum protection (MOCP) — marked or derived' },
      value: { $ref: 'calls.nameplate.mocpA' },
      unit: 'A',
      citationsFrom: 'calls.nameplate',
    },
    {
      id: 'disconnect',
      label: { es: 'Desconectador (sin fusibles)', en: 'Disconnect (non-fused)' },
      value: { $ref: 'derived.disconnect.rating' },
      unit: 'A',
      citationsFrom: 'derived.disconnect',
    },
    {
      id: 'conduit',
      label: { es: 'Diámetro de tubería', en: 'Conduit trade size' },
      value: { $ref: 'calls.conduit.tradeSize' },
      unit: 'pulg',
      citationsFrom: 'calls.conduit',
    },
    {
      id: 'drop',
      label: { es: 'Caída de tensión a esa distancia', en: 'Voltage drop at that distance' },
      value: { $ref: 'calls.circuit.voltageDrop.dropPercent' },
      unit: '%',
      citationsFrom: 'calls.circuit.voltageDrop',
      format: 'percent',
    },
  ],

  bom: [
    {
      id: 'breaker',
      item: {
        map: {
          keys: ['derived.supply.value', 'calls.circuit.breaker.rating'],
          table: {
            // 120 V units land on a 1-pole breaker; the local catalog stocks up
            // to 50 A single-pole, which no residential 115 V unit approaches.
            '120|15': 'breaker-1p-15',
            '120|20': 'breaker-1p-20',
            '120|25': 'breaker-1p-25',
            '120|30': 'breaker-1p-30',
            '120|40': 'breaker-1p-40',
            '120|50': 'breaker-1p-50',
            '240|15': 'breaker-2p-15',
            '240|20': 'breaker-2p-20',
            '240|25': 'breaker-2p-25',
            '240|30': 'breaker-2p-30',
            // 440.22 takes the rating from the nameplate MOCP, so the map has to
            // cover every standard rating the MOCP field can reach (5–60 A), not
            // just the ones a load-derived breaker used to land on.
            '240|35': 'breaker-2p-35',
            '240|40': 'breaker-2p-40',
            '240|45': 'breaker-2p-45',
            '240|50': 'breaker-2p-50',
            '240|60': 'breaker-2p-60',
          },
        },
      },
      qty: { fixed: 1 },
    },
    {
      id: 'hots',
      item: { map: { keys: ['calls.circuit.conductor.size'], table: WIRE_TABLE } },
      qty: {
        lengthWithWastage: {
          lengthM: 'answers.runLengthM',
          wastagePercent: 'options.wastagePercent',
          multiplier: 2,
        },
      },
      note: {
        es: 'los 2 conductores del circuito (fase y fase a 240 V; fase y neutro a 120 V)',
        en: 'the 2 circuit conductors (two hots at 240 V; hot and neutral at 120 V)',
      },
    },
    {
      id: 'egc-wire',
      item: { map: { keys: ['calls.egc.size'], table: WIRE_TABLE } },
      qty: {
        lengthWithWastage: { lengthM: 'answers.runLengthM', wastagePercent: 'options.wastagePercent' },
      },
      citations: ['nec2026.t250_122'],
      note: { es: 'conductor de tierra (verde)', en: 'equipment grounding conductor (green)' },
    },

    // -------- conduit run, per type --------
    {
      id: 'conduit-emt',
      when: [{ ref: 'options.conduitType', eq: 'emt' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'emt-tube-12', '3/4': 'emt-tube-34' } } },
      qty: {
        lengthWithWastage: { lengthM: 'answers.runLengthM', wastagePercent: 'options.wastagePercent' },
      },
    },
    {
      id: 'conduit-pvc',
      when: [{ ref: 'options.conduitType', eq: 'pvc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'pvc-tube-12', '3/4': 'pvc-tube-34' } } },
      qty: {
        lengthWithWastage: { lengthM: 'answers.runLengthM', wastagePercent: 'options.wastagePercent' },
      },
    },
    {
      id: 'conduit-lfnc',
      when: [{ ref: 'options.conduitType', eq: 'lfnc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'lfnc-12', '3/4': 'lfnc-34' } } },
      qty: {
        lengthWithWastage: { lengthM: 'answers.runLengthM', wastagePercent: 'options.wastagePercent' },
      },
    },

    // -------- fittings, per type --------
    {
      id: 'emt-connectors',
      when: [{ ref: 'options.conduitType', eq: 'emt' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'emt-connector-12', '3/4': 'emt-connector-34' } } },
      qty: { fixed: 2 },
    },
    {
      id: 'emt-couplings',
      when: [{ ref: 'options.conduitType', eq: 'emt' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'emt-coupling-12', '3/4': 'emt-coupling-34' } } },
      qty: { perInterval: { lengthM: 'answers.runLengthM', intervalM: 3.05, plus: 0 } },
      note: { es: 'una unión entre tramos de 10 pies', en: 'one coupling between 10-ft sticks' },
    },
    {
      id: 'emt-elbows',
      when: [
        { ref: 'options.conduitType', eq: 'emt' },
        { ref: 'options.bends', eq: 'curvas' },
      ],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'emt-elbow-12', '3/4': 'emt-elbow-34' } } },
      qty: { ref: 'options.bendCount' },
    },
    {
      id: 'pvc-elbows',
      when: [{ ref: 'options.conduitType', eq: 'pvc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'pvc-elbow-12', '3/4': 'pvc-elbow-34' } } },
      qty: { ref: 'options.bendCount' },
    },
    {
      id: 'pvc-adapters',
      when: [{ ref: 'options.conduitType', eq: 'pvc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'pvc-adapter-12', '3/4': 'pvc-adapter-34' } } },
      qty: { fixed: 2 },
    },
    {
      id: 'pvc-cement',
      when: [{ ref: 'options.conduitType', eq: 'pvc' }],
      item: { itemId: 'pvc-cement' },
      qty: { fixed: 1 },
    },
    {
      id: 'lfnc-connectors',
      when: [{ ref: 'options.conduitType', eq: 'lfnc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'lfnc-connector-12', '3/4': 'lfnc-connector-34' } } },
      qty: { fixed: 2 },
    },

    // -------- securing straps, per type (different NEC spacing) --------
    {
      id: 'emt-straps',
      when: [{ ref: 'options.conduitType', eq: 'emt' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'strap-12', '3/4': 'strap-34' } } },
      qty: { perInterval: { lengthM: 'answers.runLengthM', intervalM: 3, plus: 1 } },
      citations: ['nec2026.s358_30'],
    },
    {
      id: 'pvc-straps',
      when: [{ ref: 'options.conduitType', eq: 'pvc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'strap-12', '3/4': 'strap-34' } } },
      qty: { perInterval: { lengthM: 'answers.runLengthM', intervalM: 0.9, plus: 1 } },
      citations: ['nec2026.s352_30'],
    },
    {
      id: 'lfnc-straps',
      when: [{ ref: 'options.conduitType', eq: 'lfnc' }],
      item: { map: { keys: ['calls.conduit.tradeSize'], table: { '1/2': 'strap-12', '3/4': 'strap-34' } } },
      qty: { perInterval: { lengthM: 'answers.runLengthM', intervalM: 0.9, plus: 1 } },
      citations: ['nec2026.s356_30'],
    },

    // -------- equipment + tool --------
    {
      id: 'disconnect',
      item: { itemId: 'disconnect-60-3r' },
      qty: { fixed: 1 },
      citations: ['nec2026.s440_14'],
      note: { es: 'NEMA 3R — apto para intemperie', en: 'NEMA 3R — weather-rated' },
    },
    {
      // Pre-made whips are not sold locally — the flexible stretch to the condenser
      // is assembled on site from poliducto; its conductors come out of the same
      // wire rolls (covered by the wastage allowance).
      id: 'whip',
      item: {
        map: {
          keys: ['options.whipType'],
          table: { coraza: 'lfmc-12', poliducto: 'lfnc-12' },
        },
      },
      qty: { fixed: 2 },
      note: {
        es: 'conexión flexible al condensador, armada en sitio (~2 m; conductores del mismo rollo)',
        en: 'flexible run to the condenser, assembled on site (~2 m; conductors from the same rolls)',
      },
    },
    {
      // A liquidtight raceway sealed with an ordinary connector is not liquidtight.
      // One straight at the disconnect, one 90° at the unit — how they actually land.
      id: 'whip-connectors-lt',
      when: [{ ref: 'options.whipType', eq: 'coraza' }],
      item: { itemId: 'lfmc-connector-12' },
      qty: { fixed: 1 },
      citations: ['nec2026.s350_42'],
      note: {
        es: 'conector recto tipo LT en el desconectador',
        en: 'straight liquidtight connector at the disconnect',
      },
    },
    {
      id: 'whip-connectors-lt-90',
      when: [{ ref: 'options.whipType', eq: 'coraza' }],
      item: { itemId: 'lfmc-connector-90-12' },
      qty: { fixed: 1 },
      citations: ['nec2026.s350_42'],
      note: {
        es: 'conector curvo 90° tipo LT en la unidad exterior',
        en: '90° liquidtight connector at the condenser',
      },
    },
    {
      // 3 conductors (2 hots + EGC) terminated at both ends: the unit's terminal
      // block and the disconnect. Stranded wire under a screw without one of
      // these splays and loosens — the commonest bad A/C connection here.
      id: 'punteras',
      item: { itemId: 'puntera-cable' },
      qty: { fixed: 6 },
      note: {
        es: 'para las borneras del equipo y del desconectador (3 conductores × 2 extremos)',
        en: "for the unit's and the disconnect's terminal blocks (3 conductors × 2 ends)",
      },
    },
    {
      id: 'bender',
      when: [
        { ref: 'options.conduitType', eq: 'emt' },
        { ref: 'options.bends', eq: 'dobladora' },
      ],
      item: { itemId: 'bender-12' },
      qty: { fixed: 1 },
      optional: true,
      note: {
        es: 'herramienta — compra única; reemplaza las curvas de fábrica',
        en: 'tool — one-time purchase; replaces factory elbows',
      },
    },
  ],

  warnings: [
    {
      // The conductors are already derated for ambient by the engine; this is
      // about the TUBE. Standard PVC (352.12) and ENT/tecnoducto (362.12) are
      // both listed to 50 °C, and this flow allows up to 65 °C for a roof or
      // entretecho run — so a nonmetallic raceway up there is out of code
      // unless that specific product is listed higher. Metal (EMT, coraza LT)
      // has no such ceiling, which is why it is the suggested fix.
      //
      // ambientC is an integer field, so `gte: 51` is exactly "in excess of 50".
      // 'conditional', not 'off-code': the rule ends in «unless listed
      // otherwise», and the app cannot read the marking on the tube.
      id: 'tubo-no-metalico-caliente',
      when: [
        { ref: 'options.conduitType', in: ['pvc', 'lfnc'] },
        { ref: 'answers.ambientC', gte: 51 },
      ],
      severity: 'conditional',
      citations: ['nec2026.s352_12', 'nec2026.s362_12'],
      text: {
        es: 'A esta temperatura el tubo no metálico se sale de norma: el PVC estándar (352.12) y el tecnoducto/ENT (362.12) están listados hasta 50 °C, y aquí el recorrido va más caliente. Ojo que esto es sobre el TUBO, no sobre el cable — el cable ya se calculó con su factor de temperatura. Use tubo metálico (EMT o coraza LT) en el tramo caliente, o confirme en la etiqueta que ese tubo esté listado para más.',
        en: 'At this temperature the nonmetallic raceway falls outside the code: standard PVC (352.12) and ENT/tecnoducto (362.12) are listed to 50 °C, and this run is hotter. Note this is about the TUBE, not the wire — the conductor was already sized with the ambient correction. Use metal (EMT or liquidtight metal) on the hot stretch, or confirm on the label that the tube is listed higher.',
      },
    },
    {
      // Same 12,000 BTU model line can call for 14 AWG in the on/off version and
      // 12 AWG in the inverter one. The calculated size is the code floor, not
      // the manufacturer's floor, and 110.3(B) makes their manual enforceable.
      id: 'calibre-fabricante',
      // Only on the small gauges, where a manufacturer minimum plausibly lands
      // above the code minimum. No `severity`: this is a reminder to read the
      // manual, not a finding that the install departs from the code — putting
      // it in `deviations` would make «No cumple NEC» permanent chrome.
      when: { ref: 'calls.circuit.conductor.size', in: ['14', '12'] },
      citations: ['nec2026.s110_3_b', 'nec2026.s440_4_b'],
      text: {
        es: 'El calibre de arriba es el mínimo que exige el NEC para este MCA. El manual del equipo puede pedir uno más grueso (es común que un 12,000 BTU inverter pida 12 AWG donde el cálculo permite 14 AWG), y 110.3(B) obliga a seguir las instrucciones del fabricante: revise el manual antes de comprar el alambre.',
        en: 'The gauge above is the minimum the NEC requires for this MCA. The unit\u2019s manual may call for a heavier one (a 12,000 BTU inverter commonly specifies 12 AWG where the calculation allows 14 AWG), and 110.3(B) makes the manufacturer\u2019s instructions enforceable: check the manual before buying wire.',
      },
    },
    {
      id: 'panel-space',
      when: { ref: 'answers.panelSlots', eq: 'ninguno' },
      text: {
        es: 'No hay espacio en el panel para el térmico nuevo: considere un subpanel o reorganizar circuitos (verificar con electricista autorizado).',
        en: 'No panel space for the new breaker: consider a subpanel or rearranging circuits (verify with a licensed electrician).',
      },
    },
  ],
}
