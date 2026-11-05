import { useState } from 'react'

import { IconoCuenta } from './StoreAccountIcons'

import {
  formatearNumeroTarjeta,
  formatearVencimiento,
  marcaTarjeta,
  type CuentaBancaria,
  type DatosTarjeta,
} from '../lib/pagosTienda'
import {
  actualizarDireccion,
  borrarDireccion,
  guardarDireccion,
  type DireccionCliente,
} from '../lib/direccionesTienda'

// Componentes de pago y direcciones de la tienda (carrito y Mi cuenta).

function dinero(valor: number, moneda: 'NIO' | 'USD' = 'NIO') {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 2,
  }).format(valor)
}


// ----------------------------------------------------------
// TRANSFERENCIA: banco → cuentas de ese banco → comprobante
// ----------------------------------------------------------

type SelectorTransferenciaProps = {
  cuentas: CuentaBancaria[]
  tipoCambio: number | null
  total: number
  cuentaId: number | null
  onCuenta: (id: number) => void
  archivo: File | null
  onArchivo: (archivo: File | null) => void
  referencia: string
  onReferencia: (texto: string) => void
}

export function SelectorTransferencia({
  cuentas,
  tipoCambio,
  total,
  cuentaId,
  onCuenta,
  archivo,
  onArchivo,
  referencia,
  onReferencia,
}: SelectorTransferenciaProps) {
  const bancos = [...new Set(cuentas.map(c => c.banco))]
  const cuentaElegida = cuentas.find(c => c.id === cuentaId) ?? null
  const [banco, setBanco] = useState(cuentaElegida?.banco ?? '')
  const bancoActivo = cuentaElegida?.banco ?? banco
  const cuentasDelBanco = cuentas.filter(c => c.banco === bancoActivo)

  if (!cuentas.length) {
    return <div className="t-aviso">No hay cuentas bancarias disponibles en este momento. Elegí otra forma de pago.</div>
  }

  return (
    <div className="t-transferencia">
      <span className="t-paso-titulo">1. Elegí el banco</span>
      <div className="t-bancos" role="radiogroup" aria-label="Banco">
        {bancos.map(nombre => (
          <button
            key={nombre}
            type="button"
            role="radio"
            aria-checked={bancoActivo === nombre}
            className={bancoActivo === nombre ? 'is-activo' : ''}
            onClick={() => {
              setBanco(nombre)
              const primera = cuentas.find(c => c.banco === nombre)
              if (primera) onCuenta(primera.id)
            }}
          >
            {nombre}
          </button>
        ))}
      </div>

      {bancoActivo && (
        <>
          <span className="t-paso-titulo">2. Elegí la cuenta y transferí</span>
          <div className="t-cuentas">
            {cuentasDelBanco.map(cuenta => {
              const monto = cuenta.moneda === 'USD' && tipoCambio ? Math.round((total / tipoCambio) * 100) / 100 : total

              return (
                <label key={cuenta.id} className={cuentaId === cuenta.id ? 't-cuenta-banco is-activa' : 't-cuenta-banco'}>
                  <input type="radio" name="cuenta_bancaria" checked={cuentaId === cuenta.id} onChange={() => onCuenta(cuenta.id)} />
                  <span>
                    <strong>{cuenta.moneda === 'USD' ? 'Dólares' : 'Córdobas'} · {cuenta.tipo_cuenta}</strong>
                    <span className="t-sku">{cuenta.numero}</span>
                    <small>{cuenta.titular}</small>
                  </span>
                  <b>{dinero(monto, cuenta.moneda)}</b>
                </label>
              )
            })}
          </div>
          {cuentaElegida?.moneda === 'USD' && tipoCambio && (
            <small className="t-ayuda">Tipo de cambio: C$ {tipoCambio.toFixed(4)} por dólar.</small>
          )}

          <span className="t-paso-titulo">3. Adjuntá el comprobante</span>
          <label className="t-archivo">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={event => onArchivo(event.target.files?.[0] ?? null)}
            />
            <span>{archivo ? archivo.name : 'Elegir foto o PDF del comprobante'}</span>
          </label>
          <label>
            Número de referencia de la transferencia
            <input value={referencia} onChange={event => onReferencia(event.target.value)} placeholder="Opcional" maxLength={60} />
          </label>
          <small className="t-ayuda">Caja revisa el comprobante y valida tu pedido. Datos de demostración.</small>
        </>
      )}
    </div>
  )
}


// ----------------------------------------------------------
// TARJETA (pasarela simulada)
// ----------------------------------------------------------

type FormularioTarjetaProps = {
  datos: DatosTarjeta
  onCambio: (datos: DatosTarjeta) => void
}

export function FormularioTarjeta({ datos, onCambio }: FormularioTarjetaProps) {
  const marca = marcaTarjeta(datos.numero)

  return (
    <div className="t-tarjeta">
      <div className="t-tarjeta-demo">
        <strong>Modo demostración</strong>
        <span>No se cobra dinero real. Tarjeta aprobada: 4242 4242 4242 4242 · rechazada: 4000 0000 0000 0002.</span>
      </div>

      <label>
        Nombre en la tarjeta
        <input value={datos.nombre} onChange={event => onCambio({ ...datos, nombre: event.target.value })} autoComplete="cc-name" />
      </label>

      <label>
        <span className="t-tarjeta-etiqueta">Número de tarjeta {marca && <em className="t-marca-tarjeta">{marca}</em>}</span>
        <input
          value={datos.numero}
          onChange={event => onCambio({ ...datos, numero: formatearNumeroTarjeta(event.target.value) })}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
        />
      </label>

      <div className="t-tarjeta-fila">
        <label>
          Vence
          <input
            value={datos.vence}
            onChange={event => onCambio({ ...datos, vence: formatearVencimiento(event.target.value) })}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
          />
        </label>
        <label>
          Código de seguridad
          <input
            value={datos.cvv}
            onChange={event => onCambio({ ...datos, cvv: event.target.value.replace(/\D/g, '').slice(0, 4) })}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="CVV"
            type="password"
          />
        </label>
      </div>

      <small className="t-ayuda">Los datos de la tarjeta no se guardan: solo la marca y los últimos 4 dígitos.</small>
    </div>
  )
}


// ----------------------------------------------------------
// LIBRETA DE DIRECCIONES (Mi cuenta)
// ----------------------------------------------------------

type LibretaDireccionesProps = {
  principal: string | null
  direcciones: DireccionCliente[]
  onEditarPrincipal: () => void
  onCambio: () => void
}

export function LibretaDirecciones({ principal, direcciones, onEditarPrincipal, onCambio }: LibretaDireccionesProps) {
  const [agregando, setAgregando] = useState(false)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [alias, setAlias] = useState('')
  const [direccion, setDireccion] = useState('')
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const formularioAbierto = agregando || editandoId !== null

  function cerrarFormulario() {
    setAlias('')
    setDireccion('')
    setReferencia('')
    setAgregando(false)
    setEditandoId(null)
    setError('')
  }

  function abrirEdicion(d: DireccionCliente) {
    setAlias(d.alias)
    setDireccion(d.direccion)
    setReferencia(d.referencia ?? '')
    setAgregando(false)
    setEditandoId(d.id)
    setError('')
  }

  async function guardar() {
    setError('')

    if (!alias.trim()) return setError('Poné un nombre para reconocerla, por ejemplo "Hijo" u "Obra".')
    if (direccion.trim().length < 5) return setError('Escribí la dirección completa.')

    setGuardando(true)
    const problema = editandoId !== null
      ? await actualizarDireccion(editandoId, alias, direccion, referencia)
      : await guardarDireccion(alias, direccion, referencia)
    setGuardando(false)

    if (problema) return setError(problema)

    cerrarFormulario()
    onCambio()
  }

  async function borrar(id: number) {
    const problema = await borrarDireccion(id)

    if (editandoId === id) cerrarFormulario()
    if (problema) setError(problema)
    onCambio()
  }

  return (
    <div className="t-libreta">
      <ul>
        <li>
          <IconoCuenta nombre="pin" />
          <span>
            <strong>Mi dirección <em className="t-libreta-principal">Principal</em></strong>
            <span>{principal || 'Todavía no la registraste.'}</span>
          </span>
          <button type="button" className="t-micuenta-enlace" onClick={onEditarPrincipal}>
            {principal ? 'Editar' : 'Agregar'}
          </button>
        </li>
        {direcciones.map(d => (
          <li key={d.id}>
            <IconoCuenta nombre="pin" />
            <span>
              <strong>{d.alias}</strong>
              <span>{d.direccion}</span>
              {d.referencia && <small>{d.referencia}</small>}
            </span>
            <div className="t-libreta-acciones">
              <button type="button" className="t-micuenta-enlace" onClick={() => abrirEdicion(d)}>
                Editar
              </button>
              <button type="button" className="t-micuenta-enlace t-micuenta-enlace--quitar" onClick={() => void borrar(d.id)}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {direcciones.length === 0 && !formularioAbierto && (
        <p className="t-ayuda">¿Enviás a otro lugar? Guardá la dirección con un nombre, como "Hijo" u "Obra", y elegila al comprar.</p>
      )}

      {formularioAbierto ? (
        <div className="store-form t-libreta-form">
          <strong className="t-libreta-form-titulo">{editandoId !== null ? 'Editar dirección' : 'Nueva dirección'}</strong>
          <label>
            Nombre
            <input value={alias} onChange={event => setAlias(event.target.value)} placeholder="Hijo, Obra en Masaya..." maxLength={40} />
          </label>
          <label>
            Dirección
            <textarea value={direccion} onChange={event => setDireccion(event.target.value)} />
          </label>
          <label>
            Punto de referencia
            <input value={referencia} onChange={event => setReferencia(event.target.value)} placeholder="Opcional" />
          </label>
          {error && <div className="store-error">{error}</div>}
          <div className="store-account-actions">
            <button type="button" className="store-secondary-button" onClick={cerrarFormulario} disabled={guardando}>
              Cancelar
            </button>
            <button type="button" className="store-primary store-primary--small" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando...' : editandoId !== null ? 'Guardar cambios' : 'Guardar dirección'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="t-micuenta-enlace t-libreta-agregar" onClick={() => setAgregando(true)}>
          + Agregar otra dirección
        </button>
      )}

      {error && !formularioAbierto && <div className="store-error">{error}</div>}
    </div>
  )
}
