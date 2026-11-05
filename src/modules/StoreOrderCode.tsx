import { codigoLegible, type OrdenTienda } from '../lib/ordenTienda'

// Código de la orden en tienda que el cliente muestra en el mostrador.

function dinero(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

type PanelOrdenTiendaProps = {
  orden: OrdenTienda
  enCaja: boolean
  onCerrar: () => void
}

export function PanelOrdenTienda({ orden, enCaja, onCerrar }: PanelOrdenTiendaProps) {
  const vence = new Date(orden.expira).toLocaleString('es-NI', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <section className="t-orden-tienda" aria-live="polite">
      <div className="t-orden-codigo">
        <span>{enCaja ? 'Tu lista ya está registrada' : 'Tu código para pagar en caja'}</span>
        <strong className="t-sku">{codigoLegible(orden.codigo)}</strong>
        <small>
          {enCaja
            ? 'Pasá a caja para pagar. Este código se quita solo cuando se registre tu pago.'
            : 'Mostralo o dictalo en el mostrador. El vendedor carga tu lista y pagás en caja.'}
        </small>
      </div>

      <div className="t-orden-lista">
        <ul>
          {orden.items.map(item => (
            <li key={item.nombre}>
              <span>{item.nombre}</span>
              <b>× {item.cantidad}</b>
            </li>
          ))}
        </ul>
        <div className="t-renglon"><span>Total estimado</span><b>{dinero(orden.total)}</b></div>
        <small className="t-ayuda">
          El precio final es el del momento de la venta · Válido hasta el {vence}
        </small>
        {!enCaja && (
          <button type="button" className="t-volver" onClick={onCerrar}>
            Ya no voy a usar este código
          </button>
        )}
      </div>
    </section>
  )
}
