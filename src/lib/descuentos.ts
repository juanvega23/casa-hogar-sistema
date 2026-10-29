// Misma regla que public.descuento_vigente(): el descuento aplica
// si no tiene fecha de fin o si esa fecha (hora de Managua) aún
// no pasó; el último día todavía cuenta.

export function hoyManagua() {
  // en-CA da el formato AAAA-MM-DD, igual que las columnas date
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Managua',
  }).format(new Date())
}

export function descuentoVigente(
  porcentaje: number,
  hasta: string | null,
) {
  if (!hasta || hasta >= hoyManagua()) {
    return porcentaje
  }

  return 0
}

export function formatearFechaOferta(hasta: string) {
  const [anio, mes, dia] = hasta.split('-').map(Number)

  return new Date(anio, mes - 1, dia).toLocaleDateString('es-NI', {
    day: 'numeric',
    month: 'short',
  })
}
