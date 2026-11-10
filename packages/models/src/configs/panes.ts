/** Panes of the Models window, in display order. `level` panes are pressure levels, whose fields drop the pane name from their short label. */
export const MODEL_PANES = [
    { id: 'surface', label: 'Surface', level: false },
    { id: '925', label: '925 mb', level: true },
    { id: '850', label: '850 mb', level: true },
    { id: '700', label: '700 mb', level: true },
    { id: '500', label: '500 mb', level: true },
    { id: '250', label: '250 mb', level: true },
    { id: 'levels', label: 'More levels', level: false },
    { id: 'severe', label: 'Severe', level: false },
    { id: 'winter', label: 'Winter', level: false },
    { id: 'precip', label: 'Precip', level: false },
    { id: 'waves', label: 'Waves', level: false },
    { id: 'satellite', label: 'Satellite', level: false },
] as const;
