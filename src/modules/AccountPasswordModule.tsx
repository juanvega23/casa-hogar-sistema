import {
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'

type AccountPasswordModuleProps = {
  onClose: () => void
}

/*
 * Cambio de contraseña del propio usuario interno.
 * Necesario cuando Soporte TI asigna una contraseña temporal.
 */
export default function AccountPasswordModule({
  onClose,
}: AccountPasswordModuleProps) {
  const [clave, setClave] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')

    if (clave.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (clave !== confirmacion) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setProcesando(true)

    const { error: claveError } = await supabase.auth.updateUser({
      password: clave,
    })

    setProcesando(false)

    if (claveError) {
      setError(claveError.message)
      return
    }

    setClave('')
    setConfirmacion('')
    setExito('Tu contraseña fue actualizada correctamente.')
  }

  return (
    <div className="cash-module">
      <section className="cash-card">
        <div className="cash-section-head">
          <div>
            <span className="panel-label">MI CUENTA</span>
            <h3>Cambiar contraseña</h3>
          </div>

          <button
            type="button"
            className="product-close-button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <p className="cash-help">
          Si Soporte TI te asignó una contraseña temporal, reemplázala por una propia.
        </p>

        {error && <div className="inventory-error">{error}</div>}
        {exito && <div className="movement-success">{exito}</div>}

        <form className="cash-form" onSubmit={guardar}>
          <label>
            Nueva contraseña
            <input
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={clave}
              onChange={event => setClave(event.target.value)}
              required
            />
          </label>

          <label>
            Confirmar contraseña
            <input
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={confirmacion}
              onChange={event => setConfirmacion(event.target.value)}
              required
            />
          </label>

          <div className="cash-actions cash-field-full">
            <button
              type="submit"
              className="product-primary-button"
              disabled={procesando}
            >
              {procesando ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
