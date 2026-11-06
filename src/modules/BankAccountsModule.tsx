import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import FiltroColumna from './FiltroColumna'
import { opcionesDe } from '../lib/filtroColumna'

/*
 * Caja → Cuentas bancarias.
 *
 * Las cuentas que la tienda muestra para pagar por transferencia se
 * administran aquí (no están fijas en el código): si una cuenta
 * cambia, se edita o se desactiva sin tocar el sistema. También el
 * tipo de cambio para las cuentas en dólares.
 */

type Cuenta = {
  id: number
  banco: string
  titular: string
  numero: string
  moneda: 'NIO' | 'USD'
  tipo_cuenta: string
  activa: boolean
  orden: number
}

const CUENTA_VACIA = {
  banco: '',
  titular: 'Ferretería Casa Hogar, S.A.',
  numero: '',
  moneda: 'NIO' as 'NIO' | 'USD',
  tipo_cuenta: 'Corriente',
}

export default function BankAccountsModule() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [filtroBanco, setFiltroBanco] = useState('')
  const [filtroMoneda, setFiltroMoneda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroVisible, setFiltroVisible] = useState('')
  const [tipoCambio, setTipoCambio] = useState('')
  const [tipoCambioActual, setTipoCambioActual] = useState<number | null>(null)
  const [form, setForm] = useState(CUENTA_VACIA)
  const [editando, setEditando] = useState<Cuenta | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  function pedirDatos() {
    return Promise.all([
      supabase.from('cuentas_bancarias').select('id, banco, titular, numero, moneda, tipo_cuenta, activa, orden').order('orden'),
      supabase.from('parametros_negocio').select('tipo_cambio_usd').eq('id', 1).maybeSingle(),
    ]).then(([cuentasResp, parametrosResp]) => {
      setCargando(false)

      if (cuentasResp.error || parametrosResp.error) {
        setError((cuentasResp.error ?? parametrosResp.error)!.message)
        return
      }

      setCuentas((cuentasResp.data ?? []) as Cuenta[])
      const tc = parametrosResp.data ? Number(parametrosResp.data.tipo_cambio_usd) : null
      setTipoCambioActual(tc)
      setTipoCambio(tc ? tc.toFixed(4) : '')
    })
  }

  useEffect(() => {
    void pedirDatos()
  }, [])

  async function guardarTipoCambio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')

    const valor = Number(tipoCambio)

    if (!Number.isFinite(valor) || valor <= 0) {
      setError('Indica un tipo de cambio válido.')
      return
    }

    setProcesando(true)
    const { error: rpcError } = await supabase.rpc('actualizar_tipo_cambio', { p_valor: valor })
    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(`Tipo de cambio actualizado a C$ ${valor.toFixed(4)} por dólar.`)
    await pedirDatos()
  }

  function abrirNueva() {
    setEditando(null)
    setForm(CUENTA_VACIA)
    setMostrarForm(true)
    setError('')
    setExito('')
  }

  function abrirEdicion(cuenta: Cuenta) {
    setEditando(cuenta)
    setForm({
      banco: cuenta.banco,
      titular: cuenta.titular,
      numero: cuenta.numero,
      moneda: cuenta.moneda,
      tipo_cuenta: cuenta.tipo_cuenta,
    })
    setMostrarForm(true)
    setError('')
    setExito('')
  }

  async function guardarCuenta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')

    if (form.banco.trim().length < 2 || form.numero.trim().length < 4 || form.titular.trim().length < 3) {
      setError('Completa el banco, el titular y el número de cuenta.')
      return
    }

    const datos = {
      banco: form.banco.trim().toUpperCase(),
      titular: form.titular.trim(),
      numero: form.numero.trim(),
      moneda: form.moneda,
      tipo_cuenta: form.tipo_cuenta,
    }

    setProcesando(true)

    const { error: guardarError } = editando
      ? await supabase.from('cuentas_bancarias').update({ ...datos, updated_at: new Date().toISOString() }).eq('id', editando.id)
      : await supabase.from('cuentas_bancarias').insert({ ...datos, orden: cuentas.length + 1 })

    setProcesando(false)

    if (guardarError) {
      setError(guardarError.code === '23505' ? 'Ya existe esa cuenta en ese banco.' : guardarError.message)
      return
    }

    setExito(editando ? 'Cuenta actualizada.' : 'Cuenta agregada: ya aparece en la tienda.')
    setMostrarForm(false)
    setEditando(null)
    await pedirDatos()
  }

  async function cambiarActiva(cuenta: Cuenta) {
    setError('')
    setExito('')

    const { error: guardarError } = await supabase
      .from('cuentas_bancarias')
      .update({ activa: !cuenta.activa, updated_at: new Date().toISOString() })
      .eq('id', cuenta.id)

    if (guardarError) {
      setError(guardarError.message)
      return
    }

    setExito(cuenta.activa ? `${cuenta.banco} ${cuenta.numero} ya no se muestra en la tienda.` : `${cuenta.banco} ${cuenta.numero} vuelve a mostrarse en la tienda.`)
    await pedirDatos()
  }

  const cuentasFiltradas = cuentas.filter(cuenta =>
    (!filtroBanco || cuenta.banco === filtroBanco) &&
    (!filtroMoneda || cuenta.moneda === filtroMoneda) &&
    (!filtroTipo || cuenta.tipo_cuenta === filtroTipo) &&
    (!filtroVisible || cuenta.activa === (filtroVisible === 'si')),
  )

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando cuentas...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">CAJA</span>
          <h2>Cuentas bancarias</h2>
          <p>Cuentas que la tienda muestra para pagar por transferencia. Si una cambia, edítala o desactívala aquí.</p>
        </div>

        <button type="button" className="product-primary-button" onClick={abrirNueva}>
          + Nueva cuenta
        </button>
      </section>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      <form className="cuentas-tipo-cambio" onSubmit={guardarTipoCambio}>
        <label>
          <span>Tipo de cambio (córdobas por dólar)</span>
          <input type="number" min="1" step="0.0001" value={tipoCambio} onChange={event => setTipoCambio(event.target.value)} />
        </label>
        <button type="submit" className="product-secondary-button" disabled={procesando || Number(tipoCambio) === tipoCambioActual}>
          Guardar tipo de cambio
        </button>
        <small>Se usa para calcular cuánto transferir a las cuentas en dólares.</small>
      </form>

      {mostrarForm && (
        <form className="cash-card cash-form" onSubmit={guardarCuenta}>
          <label>
            Banco
            <input value={form.banco} onChange={event => setForm({ ...form, banco: event.target.value })} placeholder="BANPRO, LAFISE, BAC..." />
          </label>
          <label>
            Número de cuenta
            <input value={form.numero} onChange={event => setForm({ ...form, numero: event.target.value })} />
          </label>
          <label>
            Titular
            <input value={form.titular} onChange={event => setForm({ ...form, titular: event.target.value })} />
          </label>
          <label>
            Moneda
            <select value={form.moneda} onChange={event => setForm({ ...form, moneda: event.target.value as 'NIO' | 'USD' })}>
              <option value="NIO">Córdobas</option>
              <option value="USD">Dólares</option>
            </select>
          </label>
          <label>
            Tipo de cuenta
            <select value={form.tipo_cuenta} onChange={event => setForm({ ...form, tipo_cuenta: event.target.value })}>
              <option value="Corriente">Corriente</option>
              <option value="Ahorro">Ahorro</option>
            </select>
          </label>
          <div className="cash-actions cash-field-full">
            <button type="button" className="product-secondary-button" onClick={() => setMostrarForm(false)} disabled={procesando}>
              Cancelar
            </button>
            <button type="submit" className="product-primary-button" disabled={procesando}>
              {procesando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar cuenta'}
            </button>
          </div>
        </form>
      )}

      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <FiltroColumna titulo="Banco" todos="Todos los bancos" valor={filtroBanco} opciones={opcionesDe(cuentas, c => c.banco)} onCambiar={setFiltroBanco} />
              <th>Número</th>
              <FiltroColumna titulo="Moneda" todos="Todas las monedas" valor={filtroMoneda} opciones={[['NIO', 'Córdobas'], ['USD', 'Dólares']]} onCambiar={setFiltroMoneda} />
              <FiltroColumna titulo="Tipo" todos="Todos los tipos" valor={filtroTipo} opciones={opcionesDe(cuentas, c => c.tipo_cuenta)} onCambiar={setFiltroTipo} />
              <th>Titular</th>
              <FiltroColumna titulo="En la tienda" todos="Visibles y ocultas" valor={filtroVisible} opciones={[['si', 'Visible'], ['no', 'Oculta']]} onCambiar={setFiltroVisible} />
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cuentasFiltradas.length === 0 && (
              <tr><td colSpan={7} className="inventory-empty">No hay cuentas para mostrar.</td></tr>
            )}
            {cuentasFiltradas.map(cuenta => (
              <tr key={cuenta.id}>
                <td><strong>{cuenta.banco}</strong></td>
                <td className="kardex-documento">{cuenta.numero}</td>
                <td>{cuenta.moneda === 'USD' ? 'Dólares' : 'Córdobas'}</td>
                <td>{cuenta.tipo_cuenta}</td>
                <td>{cuenta.titular}</td>
                <td>
                  <span className={cuenta.activa ? 'history-status history-status--ok' : 'history-status history-status--danger'}>
                    {cuenta.activa ? 'Visible' : 'Oculta'}
                  </span>
                </td>
                <td>
                  <div className="cuentas-acciones">
                    <button type="button" className="product-edit-button" onClick={() => abrirEdicion(cuenta)}>Editar</button>
                    <button type="button" className="product-secondary-button" onClick={() => void cambiarActiva(cuenta)}>
                      {cuenta.activa ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
