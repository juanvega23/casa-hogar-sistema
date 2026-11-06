import type { OpcionColumna } from '../lib/filtroColumna'

// Encabezado de tabla que filtra su columna, igual que en Productos: el título es
// el filtro y un select transparente encima abre el menú al hacer clic.
// Es para columnas con pocos valores que se repiten (estado, tipo, canal).

export default function FiltroColumna({
  titulo,
  todos,
  valor,
  opciones,
  onCambiar,
}: {
  titulo: string
  todos: string
  valor: string
  opciones: OpcionColumna[]
  onCambiar: (valor: string) => void
}) {
  return (
    <th className={valor ? 'th-filtro is-activo' : 'th-filtro'}>
      <span>{titulo}</span>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
      <select
        value={valor}
        onChange={event => onCambiar(event.target.value)}
        aria-label={`Filtrar por ${titulo.toLowerCase()}`}
      >
        <option value="">{todos}</option>
        {opciones.map(([opcion, texto]) => (
          <option key={opcion} value={opcion}>{texto}</option>
        ))}
      </select>
    </th>
  )
}
