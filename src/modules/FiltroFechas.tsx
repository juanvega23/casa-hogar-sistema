// Par de fechas Desde y Hasta para filtrar una lista.

export default function FiltroFechas({
  desde,
  hasta,
  onDesde,
  onHasta,
}: {
  desde: string
  hasta: string
  onDesde: (valor: string) => void
  onHasta: (valor: string) => void
}) {
  return (
    <div className="filtro-fechas">
      <label>
        Desde
        <input type="date" value={desde} max={hasta || undefined} onChange={event => onDesde(event.target.value)} />
      </label>
      <label>
        Hasta
        <input type="date" value={hasta} min={desde || undefined} onChange={event => onHasta(event.target.value)} />
      </label>
    </div>
  )
}
