import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  errorCedula,
  errorRuc,
  mensajeIdentidad,
} from '../lib/identidad'


type Cliente = {
  id: number
  codigo: string
  tipo_cliente: 'natural' | 'juridica'
  nombre: string
  identificacion: string | null
  telefono: string | null
  correo: string | null
  direccion: string | null
  permite_credito: boolean
  limite_credito: number | null
  activo: boolean
  created_at: string
}


type FormularioCliente = {
  codigo: string
  tipo_cliente: 'natural' | 'juridica'
  nombre: string
  identificacion: string
  telefono: string
  correo: string
  direccion: string
  permite_credito: boolean
  limite_credito: string
  activo: boolean
}


type ClientsModuleProps = {
  roleCode: string
}


const formularioInicial: FormularioCliente = {
  codigo: '',
  tipo_cliente: 'natural',
  nombre: '',
  identificacion: '',
  telefono: '',
  correo: '',
  direccion: '',
  permite_credito: false,
  limite_credito: '',
  activo: true,
}


function formatearCordobas(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}


function textoOpcional(valor: string) {
  const limpio = valor.trim()
  return limpio || null
}


export default function ClientsModule({
  roleCode,
}: ClientsModuleProps) {
  const puedeGestionar =
    roleCode === 'vendedor'

  const puedeConsultar = [
    'vendedor',
    'responsable_comercial',
    'gerencia',
  ].includes(roleCode)

  const [clientes, setClientes] =
    useState<Cliente[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [guardando, setGuardando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [exito, setExito] =
    useState('')

  const [mostrarFormulario, setMostrarFormulario] =
    useState(false)

  const [clienteEditandoId, setClienteEditandoId] =
    useState<number | null>(null)

  const [formulario, setFormulario] =
    useState<FormularioCliente>(formularioInicial)


  async function cargarClientes() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const { data, error } =
      await supabase
        .from('clientes')
        .select(`
          id,
          codigo,
          tipo_cliente,
          nombre,
          identificacion,
          telefono,
          correo,
          direccion,
          permite_credito,
          limite_credito,
          activo,
          created_at
        `)
        .order('nombre', {
          ascending: true,
        })

    if (error) {
      setClientes([])
      setError(
        `No fue posible cargar los clientes: ${error.message}`,
      )
      setCargando(false)
      return
    }

    const lista: Cliente[] =
      (data ?? []).map((cliente) => ({
        id: Number(cliente.id),
        codigo: String(cliente.codigo),
        tipo_cliente:
          cliente.tipo_cliente as
            | 'natural'
            | 'juridica',
        nombre: String(cliente.nombre),
        identificacion:
          cliente.identificacion,
        telefono: cliente.telefono,
        correo: cliente.correo,
        direccion: cliente.direccion,
        permite_credito: Boolean(
          cliente.permite_credito,
        ),
        limite_credito:
          cliente.limite_credito === null
            ? null
            : Number(cliente.limite_credito),
        activo: Boolean(cliente.activo),
        created_at: String(
          cliente.created_at,
        ),
      }))

    setClientes(lista)
    setCargando(false)
  }


  useEffect(() => {
    void cargarClientes()
  }, [roleCode])


  const clientesFiltrados =
    useMemo(() => {
      const termino =
        busqueda.trim().toLowerCase()

      if (!termino) {
        return clientes
      }

      return clientes.filter((cliente) =>
        [
          cliente.codigo,
          cliente.nombre,
          cliente.identificacion ?? '',
          cliente.telefono ?? '',
          cliente.correo ?? '',
        ].some((valor) =>
          valor
            .toLowerCase()
            .includes(termino),
        ),
      )
    }, [clientes, busqueda])


  const clientesActivos =
    clientes.filter(
      (cliente) => cliente.activo,
    ).length

  const clientesCredito =
    clientes.filter(
      (cliente) =>
        cliente.activo &&
        cliente.permite_credito,
    ).length

  const clientesJuridicos =
    clientes.filter(
      (cliente) =>
        cliente.tipo_cliente === 'juridica',
    ).length


  function abrirNuevoCliente() {
    setClienteEditandoId(null)
    setFormulario(formularioInicial)
    setError('')
    setExito('')
    setMostrarFormulario(true)
  }


  function abrirEdicion(cliente: Cliente) {
    setClienteEditandoId(cliente.id)
    setFormulario({
      codigo: cliente.codigo,
      tipo_cliente: cliente.tipo_cliente,
      nombre: cliente.nombre,
      identificacion:
        cliente.identificacion ?? '',
      telefono: cliente.telefono ?? '',
      correo: cliente.correo ?? '',
      direccion: cliente.direccion ?? '',
      permite_credito:
        cliente.permite_credito,
      limite_credito:
        cliente.limite_credito === null
          ? ''
          : String(cliente.limite_credito),
      activo: cliente.activo,
    })
    setError('')
    setExito('')
    setMostrarFormulario(true)
  }


  function cerrarFormulario() {
    if (guardando) {
      return
    }

    setMostrarFormulario(false)
    setClienteEditandoId(null)
    setFormulario(formularioInicial)
  }


  async function guardarCliente(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!puedeGestionar) {
      setError(
        'Este perfil solamente puede consultar clientes.',
      )
      return
    }

    setError('')
    setExito('')

    const codigo =
      formulario.codigo.trim().toUpperCase()

    const nombre =
      formulario.nombre.trim()

    if (!codigo) {
      setError(
        'Debes indicar el código del cliente.',
      )
      return
    }

    if (!nombre) {
      setError(
        'Debes indicar el nombre del cliente.',
      )
      return
    }

    // Persona natural: cédula; empresa: RUC J + 13 dígitos (la base valida lo mismo)
    const problemaIdentificacion =
      formulario.identificacion.trim()
        ? formulario.tipo_cliente === 'juridica'
          ? errorRuc(formulario.identificacion, false)
          : errorCedula(formulario.identificacion)
        : null

    if (problemaIdentificacion) {
      setError(problemaIdentificacion)
      return
    }

    let limiteCredito: number | null = null

    if (formulario.permite_credito) {
      limiteCredito = Number(
        formulario.limite_credito,
      )

      if (
        !Number.isFinite(limiteCredito) ||
        limiteCredito <= 0
      ) {
        setError(
          'Si el cliente tiene crédito, debes indicar un límite mayor que cero.',
        )
        return
      }
    }

    setGuardando(true)

    const datos = {
      codigo,
      tipo_cliente:
        formulario.tipo_cliente,
      nombre,
      identificacion:
        textoOpcional(
          formulario.identificacion,
        ),
      telefono:
        textoOpcional(formulario.telefono),
      correo:
        textoOpcional(formulario.correo),
      direccion:
        textoOpcional(formulario.direccion),
      permite_credito:
        formulario.permite_credito,
      limite_credito: limiteCredito,
      activo: formulario.activo,
    }

    const respuesta =
      clienteEditandoId === null
        ? await supabase
            .from('clientes')
            .insert(datos)
        : await supabase
            .from('clientes')
            .update(datos)
            .eq('id', clienteEditandoId)

    if (respuesta.error) {
      const mensaje =
        respuesta.error.code === '23505' &&
        !/identificacion/.test(respuesta.error.message)
          ? 'Ya existe un cliente con ese código.'
          : mensajeIdentidad(respuesta.error.message)

      setError(mensaje)
      setGuardando(false)
      return
    }

    setExito(
      clienteEditandoId === null
        ? 'Cliente registrado correctamente.'
        : 'Cliente actualizado correctamente.',
    )

    setMostrarFormulario(false)
    setClienteEditandoId(null)
    setFormulario(formularioInicial)

    await cargarClientes()
    setGuardando(false)
  }


  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso al módulo de clientes.
      </div>
    )
  }


  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando clientes...</span>
      </div>
    )
  }


  return (
    <div className="clients-module">
      <section className="clients-toolbar">
        <div>
          <span className="panel-label">
            CLIENTES
          </span>

          <h2>Gestión de clientes</h2>

          <p>
            {puedeGestionar
              ? 'Consulta, registra y actualiza la información comercial de los clientes.'
              : 'Consulta la información de los clientes registrados.'}
          </p>
        </div>

        <div className="clients-toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void cargarClientes()
            }
          >
            ↻ Actualizar
          </button>

          {puedeGestionar && (
            <button
              type="button"
              className="primary-button"
              onClick={abrirNuevoCliente}
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </section>


      <div className="clients-summary-grid">
        <article className="clients-summary-card">
          <span>TOTAL</span>
          <strong>{clientes.length}</strong>
          <p>clientes registrados</p>
        </article>

        <article className="clients-summary-card">
          <span>ACTIVOS</span>
          <strong>{clientesActivos}</strong>
          <p>disponibles para operar</p>
        </article>

        <article className="clients-summary-card">
          <span>CON CRÉDITO</span>
          <strong>{clientesCredito}</strong>
          <p>clientes autorizados</p>
        </article>

        <article className="clients-summary-card">
          <span>JURÍDICOS</span>
          <strong>{clientesJuridicos}</strong>
          <p>empresas registradas</p>
        </article>
      </div>


      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {exito && (
        <div className="success-message">
          {exito}
        </div>
      )}


      {mostrarFormulario && puedeGestionar && (
        <section className="clients-form-card">
          <div className="clients-form-head">
            <div>
              <span className="panel-label">
                {clienteEditandoId === null
                  ? 'NUEVO CLIENTE'
                  : 'EDITAR CLIENTE'}
              </span>

              <h3>
                {clienteEditandoId === null
                  ? 'Registrar cliente'
                  : 'Actualizar cliente'}
              </h3>

              <p>
                Completa la información necesaria para el proceso comercial.
              </p>
            </div>

            <button
              type="button"
              className="clients-close-button"
              onClick={cerrarFormulario}
              aria-label="Cerrar formulario"
            >
              ×
            </button>
          </div>

          <form
            className="clients-form"
            onSubmit={guardarCliente}
          >
            <label className="clients-field">
              <span>Código *</span>
              <input
                value={formulario.codigo}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    codigo: event.target.value,
                  }))
                }
                placeholder="Ej. CLI-001"
                maxLength={30}
                required
              />
            </label>

            <label className="clients-field">
              <span>Tipo de cliente *</span>
              <select
                value={formulario.tipo_cliente}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    tipo_cliente:
                      event.target.value as
                        | 'natural'
                        | 'juridica',
                  }))
                }
              >
                <option value="natural">
                  Persona natural
                </option>
                <option value="juridica">
                  Persona jurídica
                </option>
              </select>
            </label>

            <label className="clients-field clients-field--double">
              <span>Nombre / Razón social *</span>
              <input
                value={formulario.nombre}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    nombre: event.target.value,
                  }))
                }
                placeholder="Nombre del cliente"
                required
              />
            </label>

            <label className="clients-field">
              <span>Identificación</span>
              <input
                value={formulario.identificacion}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    identificacion:
                      event.target.value,
                  }))
                }
                placeholder={
                  formulario.tipo_cliente === 'juridica'
                    ? 'RUC: J0310000000000'
                    : 'Cédula: 001-010190-0000M'
                }
              />
            </label>

            <label className="clients-field">
              <span>Teléfono</span>
              <input
                value={formulario.telefono}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    telefono: event.target.value,
                  }))
                }
                placeholder="Número de contacto"
              />
            </label>

            <label className="clients-field clients-field--double">
              <span>Correo electrónico</span>
              <input
                type="email"
                value={formulario.correo}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    correo: event.target.value,
                  }))
                }
                placeholder="cliente@correo.com"
              />
            </label>

            <label className="clients-field clients-field--full">
              <span>Dirección</span>
              <textarea
                value={formulario.direccion}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    direccion: event.target.value,
                  }))
                }
                placeholder="Dirección del cliente"
              />
            </label>

            <label className="clients-check-card">
              <input
                type="checkbox"
                checked={formulario.permite_credito}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    permite_credito:
                      event.target.checked,
                    limite_credito:
                      event.target.checked
                        ? actual.limite_credito
                        : '',
                  }))
                }
              />

              <span>
                <strong>Autorizar crédito</strong>
                <small>
                  Permite registrar ventas a crédito para este cliente.
                </small>
              </span>
            </label>

            <label className="clients-field">
              <span>Límite de crédito</span>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={!formulario.permite_credito}
                value={formulario.limite_credito}
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    limite_credito:
                      event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </label>

            <label className="clients-field">
              <span>Estado</span>
              <select
                value={
                  formulario.activo
                    ? 'activo'
                    : 'inactivo'
                }
                onChange={(event) =>
                  setFormulario((actual) => ({
                    ...actual,
                    activo:
                      event.target.value ===
                      'activo',
                  }))
                }
              >
                <option value="activo">
                  Activo
                </option>
                <option value="inactivo">
                  Inactivo
                </option>
              </select>
            </label>

            <div className="clients-form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cerrarFormulario}
                disabled={guardando}
              >
                Cancelar
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={guardando}
              >
                {guardando
                  ? 'Guardando...'
                  : clienteEditandoId === null
                    ? 'Registrar cliente'
                    : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </section>
      )}


      <section className="clients-list-card">
        <div className="clients-list-head">
          <div>
            <span className="panel-label">
              REGISTRO
            </span>
            <h3>Clientes</h3>
          </div>

          <span className="clients-result-count">
            {clientesFiltrados.length}{' '}
            resultado
            {clientesFiltrados.length === 1
              ? ''
              : 's'}
          </span>
        </div>

        <div className="clients-search">
          <span>⌕</span>
          <input
            value={busqueda}
            onChange={(event) =>
              setBusqueda(event.target.value)
            }
            placeholder="Buscar por código, nombre, identificación, teléfono o correo..."
          />
        </div>

        <div className="clients-table-container">
          <table className="clients-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>Crédito</th>
                <th>Estado</th>
                {puedeGestionar && (
                  <th>Acciones</th>
                )}
              </tr>
            </thead>

            <tbody>
              {clientesFiltrados.length > 0 ? (
                clientesFiltrados.map(
                  (cliente) => (
                    <tr key={cliente.id}>
                      <td>
                        <span className="product-code">
                          {cliente.codigo}
                        </span>
                      </td>

                      <td>
                        <div className="clients-name-cell">
                          <strong>
                            {cliente.nombre}
                          </strong>
                          <span>
                            {cliente.tipo_cliente ===
                            'juridica'
                              ? 'Persona jurídica'
                              : 'Persona natural'}
                            {cliente.identificacion
                              ? ` · ${cliente.identificacion}`
                              : ''}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="clients-contact-cell">
                          <span>
                            {cliente.telefono ||
                              'Sin teléfono'}
                          </span>
                          <small>
                            {cliente.correo ||
                              'Sin correo'}
                          </small>
                        </div>
                      </td>

                      <td>
                        {cliente.permite_credito ? (
                          <div className="clients-credit-cell">
                            <span className="status-badge status-success">
                              Autorizado
                            </span>
                            <small>
                              {cliente.limite_credito !==
                              null
                                ? formatearCordobas(
                                    cliente.limite_credito,
                                  )
                                : 'Sin límite'}
                            </small>
                          </div>
                        ) : (
                          <span className="clients-muted">
                            No autorizado
                          </span>
                        )}
                      </td>

                      <td>
                        <span
                          className={`status-badge ${
                            cliente.activo
                              ? 'status-success'
                              : 'status-danger'
                          }`}
                        >
                          {cliente.activo
                            ? 'Activo'
                            : 'Inactivo'}
                        </span>
                      </td>

                      {puedeGestionar && (
                        <td>
                          <button
                            type="button"
                            className="clients-edit-button"
                            onClick={() =>
                              abrirEdicion(cliente)
                            }
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td
                    colSpan={
                      puedeGestionar ? 6 : 5
                    }
                    className="inventory-empty"
                  >
                    No se encontraron clientes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
