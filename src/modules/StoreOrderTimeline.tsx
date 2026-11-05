/*
 * Línea de tiempo de un pedido en Mi cuenta. Usa los mismos estados del
 * flujo: pendiente_validacion → validado → en_despacho → entregado.
 */

type EstadoPaso = 'hecho' | 'actual' | 'pendiente' | 'detenido'

type Paso = {
  texto: string
  estado: EstadoPaso
  nota?: string
}

const ORDEN = ['pendiente_validacion', 'validado', 'en_despacho', 'entregado']

function armarPasos(estado: string, modalidad: string, nota: string): Paso[] {
  if (estado === 'rechazado' || estado === 'cancelado') {
    return [
      { texto: 'Recibido', estado: 'hecho' },
      { texto: estado === 'rechazado' ? 'Rechazado' : 'Cancelado', estado: 'detenido' },
    ]
  }

  const textos = modalidad === 'domicilio'
    ? ['Recibido', 'Confirmado', 'En camino', 'Entregado']
    : ['Recibido', 'Confirmado', 'Listo para retirar', 'Retirado']

  const posicion = ORDEN.indexOf(estado)
  const terminado = estado === 'entregado'

  return textos.map((texto, indice) => ({
    texto,
    estado: indice < posicion || terminado ? 'hecho' : indice === posicion ? 'actual' : 'pendiente',
    // "Por confirmar" o "Esperando pago" aclaran en qué va el primer paso
    nota: indice === posicion && estado === 'pendiente_validacion' ? nota : undefined,
  }))
}

export function StoreOrderTimeline({
  estado,
  modalidad,
  nota,
}: {
  estado: string
  modalidad: string
  nota: string
}) {
  const pasos = armarPasos(estado, modalidad, nota)

  return (
    <ol
      className="t-seguimiento"
      aria-label="Estado del pedido"
      style={{ gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))` }}
    >
      {pasos.map(paso => (
        <li
          key={paso.texto}
          className={`t-seguimiento-paso t-seguimiento-paso--${paso.estado}${estado === 'cancelado' ? ' t-seguimiento-paso--cancelado' : ''}`}
          aria-current={paso.estado === 'actual' || paso.estado === 'detenido' ? 'step' : undefined}
        >
          <span className="t-seguimiento-punto" aria-hidden="true">
            {paso.estado === 'hecho' && (
              <svg viewBox="0 0 12 12"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg>
            )}
            {paso.estado === 'detenido' && (
              <svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" /></svg>
            )}
          </span>
          <strong>{paso.texto}</strong>
          {paso.nota && <small>{paso.nota}</small>}
        </li>
      ))}
    </ol>
  )
}
