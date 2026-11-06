// Filtro por rango de fechas según el día en Managua, no en la hora universal
// con que se guarda: una venta de las 7 p. m. sigue siendo de ese mismo día.

export function enRangoDeFechas(valor: string | null, desde: string, hasta: string) {
  if (!desde && !hasta) return true
  if (!valor) return false

  const dia = new Date(valor).toLocaleDateString('en-CA', { timeZone: 'America/Managua' })

  return (!desde || dia >= desde) && (!hasta || dia <= hasta)
}
