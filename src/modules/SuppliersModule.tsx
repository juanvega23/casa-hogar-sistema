import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


type Proveedor = {
  id: number
  codigo: string
  nombre: string
  ruc: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  activo: boolean
  created_at: string
  updated_at: string
}


type FormProveedor = {
  nombre: string
  ruc: string
  contacto: string
  telefono: string
  email: string
  direccion: string
}


const FORM_INICIAL: FormProveedor = {
  nombre: '',
  ruc: '',
  contacto: '',
  telefono: '',
  email: '',
  direccion: '',
}


export default function SuppliersModule() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [busqueda, setBusqueda] = useState('')

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const [mostrarFormulario, setMostrarFormulario] =
    useState(false)

  const [proveedorEditando, setProveedorEditando] =
    useState<Proveedor | null>(null)

  const [form, setForm] =
    useState<FormProveedor>(FORM_INICIAL)


  // ==========================================================
  // CARGAR PROVEEDORES
  // ==========================================================

  async function cargarProveedores() {
    try {
      setCargando(true)
      setError('')

      const { data, error } = await supabase
        .from('proveedores')
        .select(`
          id,
          codigo,
          nombre,
          ruc,
          contacto,
          telefono,
          email,
          direccion,
          activo,
          created_at,
          updated_at
        `)
        .order('nombre', {
          ascending: true,
        })

      if (error) {
        throw error
      }

      setProveedores(
        (data ?? []) as Proveedor[],
      )
    } catch (err) {
      const mensajeError =
        err instanceof Error
          ? err.message
          : 'No fue posible cargar los proveedores.'

      setError(mensajeError)
    } finally {
      setCargando(false)
    }
  }


  useEffect(() => {
    void cargarProveedores()
  }, [])


  // ==========================================================
  // ESTADÍSTICAS
  // ==========================================================

  const activos = useMemo(
    () =>
      proveedores.filter(
        proveedor => proveedor.activo,
      ).length,
    [proveedores],
  )


  const inactivos =
    proveedores.length - activos


  const conContacto = useMemo(
    () =>
      proveedores.filter(
        proveedor =>
          Boolean(
            proveedor.telefono?.trim() ||
            proveedor.email?.trim(),
          ),
      ).length,
    [proveedores],
  )


  // ==========================================================
  // FILTRO
  // ==========================================================

  const proveedoresFiltrados =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return proveedores
      }

      return proveedores.filter(
        proveedor => {
          const texto = [
            proveedor.codigo,
            proveedor.nombre,
            proveedor.ruc ?? '',
            proveedor.contacto ?? '',
            proveedor.telefono ?? '',
            proveedor.email ?? '',
            proveedor.direccion ?? '',
          ]
            .join(' ')
            .toLowerCase()

          return texto.includes(termino)
        },
      )
    }, [
      proveedores,
      busqueda,
    ])


  // ==========================================================
  // FORMULARIO
  // ==========================================================

  function abrirNuevoProveedor() {
    setProveedorEditando(null)
    setForm(FORM_INICIAL)

    setError('')
    setMensaje('')

    setMostrarFormulario(true)
  }


  function abrirEditarProveedor(
    proveedor: Proveedor,
  ) {
    setProveedorEditando(proveedor)

    setForm({
      nombre:
        proveedor.nombre ?? '',

      ruc:
        proveedor.ruc ?? '',

      contacto:
        proveedor.contacto ?? '',

      telefono:
        proveedor.telefono ?? '',

      email:
        proveedor.email ?? '',

      direccion:
        proveedor.direccion ?? '',
    })

    setError('')
    setMensaje('')

    setMostrarFormulario(true)
  }


  function cerrarFormulario() {
    if (guardando) {
      return
    }

    setMostrarFormulario(false)
    setProveedorEditando(null)
    setForm(FORM_INICIAL)
  }


  function actualizarCampo(
    campo: keyof FormProveedor,
    valor: string,
  ) {
    setForm(actual => ({
      ...actual,
      [campo]: valor,
    }))
  }


  // ==========================================================
  // GUARDAR PROVEEDOR
  // ==========================================================

  async function guardarProveedor(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    try {
      setGuardando(true)
      setError('')
      setMensaje('')

      const nombre =
        form.nombre.trim()

      if (nombre.length < 2) {
        throw new Error(
          'Ingrese un nombre válido para el proveedor.',
        )
      }


      const payload = {
        nombre,

        ruc:
          form.ruc.trim() ||
          null,

        contacto:
          form.contacto.trim() ||
          null,

        telefono:
          form.telefono.trim() ||
          null,

        email:
          form.email.trim() ||
          null,

        direccion:
          form.direccion.trim() ||
          null,
      }


      if (proveedorEditando) {
        const { error } = await supabase
          .from('proveedores')
          .update(payload)
          .eq(
            'id',
            proveedorEditando.id,
          )

        if (error) {
          throw error
        }

        setMensaje(
          'Proveedor actualizado correctamente.',
        )
      } else {
        const { error } = await supabase
          .from('proveedores')
          .insert(payload)

        if (error) {
          throw error
        }

        setMensaje(
          'Proveedor creado correctamente.',
        )
      }


      setMostrarFormulario(false)
      setProveedorEditando(null)
      setForm(FORM_INICIAL)

      await cargarProveedores()
    } catch (err) {
      const mensajeError =
        err instanceof Error
          ? err.message
          : 'No fue posible guardar el proveedor.'

      setError(mensajeError)
    } finally {
      setGuardando(false)
    }
  }


  // ==========================================================
  // ACTIVAR / DESACTIVAR
  // ==========================================================

  async function cambiarEstado(
    proveedor: Proveedor,
  ) {
    const accion =
      proveedor.activo
        ? 'desactivar'
        : 'activar'

    const confirmado =
      window.confirm(
        `¿Deseas ${accion} al proveedor ${proveedor.nombre}?`,
      )

    if (!confirmado) {
      return
    }


    try {
      setError('')
      setMensaje('')

      const { error } = await supabase
        .from('proveedores')
        .update({
          activo:
            !proveedor.activo,
        })
        .eq(
          'id',
          proveedor.id,
        )

      if (error) {
        throw error
      }

      setMensaje(
        proveedor.activo
          ? 'Proveedor desactivado correctamente.'
          : 'Proveedor activado correctamente.',
      )

      await cargarProveedores()
    } catch (err) {
      const mensajeError =
        err instanceof Error
          ? err.message
          : 'No fue posible actualizar el proveedor.'

      setError(mensajeError)
    }
  }


  // ==========================================================
  // INTERFAZ
  // ==========================================================

  return (
    <div className="inventory-module">

      {/* ENCABEZADO */}

      <div className="inventory-toolbar">

        <div>
          <span className="panel-label">
            GESTIÓN DE COMPRAS
          </span>

          <h2>
            Proveedores
          </h2>

          <p>
            Administración del catálogo de
            proveedores de Casa Hogar.
          </p>
        </div>


        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void cargarProveedores()
            }
            disabled={cargando}
          >
            ↻ Actualizar
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={
              abrirNuevoProveedor
            }
          >
            + Nuevo proveedor
          </button>
        </div>

      </div>


      {/* ESTADÍSTICAS */}

      <div className="inventory-stats">

        <div className="inventory-stat-card">
          <span>
            PROVEEDORES
          </span>

          <strong>
            {proveedores.length}
          </strong>

          <small>
            registrados
          </small>
        </div>


        <div className="inventory-stat-card">
          <span>
            ACTIVOS
          </span>

          <strong>
            {activos}
          </strong>

          <small>
            disponibles para compras
          </small>
        </div>


        <div className="inventory-stat-card">
          <span>
            INACTIVOS
          </span>

          <strong>
            {inactivos}
          </strong>

          <small>
            fuera de operación
          </small>
        </div>


        <div className="inventory-stat-card">
          <span>
            CON CONTACTO
          </span>

          <strong>
            {conContacto}
          </strong>

          <small>
            teléfono o correo
          </small>
        </div>

      </div>


      {/* MENSAJES */}

      {mensaje && (
        <div className="success-message">
          {mensaje}
        </div>
      )}


      {error && (
        <div className="error-message">
          {error}
        </div>
      )}


      {/* FORMULARIO */}

      {mostrarFormulario && (

        <div className="inventory-toolbar">

          <div
            style={{
              width: '100%',
            }}
          >

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'flex-start',
                gap: '20px',
                marginBottom: '22px',
              }}
            >

              <div>
                <span className="panel-label">
                  {proveedorEditando
                    ? 'EDITAR PROVEEDOR'
                    : 'NUEVO PROVEEDOR'}
                </span>

                <h2>
                  {proveedorEditando
                    ? proveedorEditando.nombre
                    : 'Registrar proveedor'}
                </h2>

                <p>
                  Completa los datos del
                  proveedor.
                </p>
              </div>


              <button
                type="button"
                className="secondary-button"
                onClick={
                  cerrarFormulario
                }
              >
                ✕ Cerrar
              </button>

            </div>


            <form
              onSubmit={
                guardarProveedor
              }
            >

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(3, minmax(0, 1fr))',
                  gap: '16px',
                }}
              >

                <label>
                  Nombre *

                  <input
                    type="text"
                    value={form.nombre}
                    onChange={event =>
                      actualizarCampo(
                        'nombre',
                        event.target.value,
                      )
                    }
                    placeholder="Nombre del proveedor"
                    required
                  />
                </label>


                <label>
                  RUC

                  <input
                    type="text"
                    value={form.ruc}
                    onChange={event =>
                      actualizarCampo(
                        'ruc',
                        event.target.value,
                      )
                    }
                    placeholder="Número RUC"
                  />
                </label>


                <label>
                  Persona de contacto

                  <input
                    type="text"
                    value={form.contacto}
                    onChange={event =>
                      actualizarCampo(
                        'contacto',
                        event.target.value,
                      )
                    }
                    placeholder="Nombre del contacto"
                  />
                </label>


                <label>
                  Teléfono

                  <input
                    type="text"
                    value={form.telefono}
                    onChange={event =>
                      actualizarCampo(
                        'telefono',
                        event.target.value,
                      )
                    }
                    placeholder="Teléfono"
                  />
                </label>


                <label>
                  Correo

                  <input
                    type="email"
                    value={form.email}
                    onChange={event =>
                      actualizarCampo(
                        'email',
                        event.target.value,
                      )
                    }
                    placeholder="correo@proveedor.com"
                  />
                </label>


                <label>
                  Dirección

                  <input
                    type="text"
                    value={form.direccion}
                    onChange={event =>
                      actualizarCampo(
                        'direccion',
                        event.target.value,
                      )
                    }
                    placeholder="Dirección"
                  />
                </label>

              </div>


              <div
                style={{
                  display: 'flex',
                  justifyContent:
                    'flex-end',
                  gap: '10px',
                  marginTop: '22px',
                }}
              >

                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    cerrarFormulario
                  }
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
                    : proveedorEditando
                      ? 'Guardar cambios'
                      : 'Registrar proveedor'}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}


      {/* BUSCADOR */}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent:
            'space-between',
          gap: '20px',
        }}
      >

        <input
          type="search"
          className="inventory-search"
          placeholder="⌕  Buscar por código, proveedor, RUC, contacto..."
          value={busqueda}
          onChange={event =>
            setBusqueda(
              event.target.value,
            )
          }
        />

        <span
          style={{
            fontSize: '12px',
            color: '#7b8494',
          }}
        >
          {proveedoresFiltrados.length}
          {' '}
          {proveedoresFiltrados.length === 1
            ? 'proveedor'
            : 'proveedores'}
        </span>

      </div>


      {/* TABLA */}

      <div className="inventory-table-wrapper">

        <table className="inventory-table">

          <thead>
            <tr>
              <th>CÓDIGO</th>
              <th>PROVEEDOR</th>
              <th>RUC</th>
              <th>CONTACTO</th>
              <th>TELÉFONO</th>
              <th>CORREO</th>
              <th>ESTADO</th>
              <th>ACCIONES</th>
            </tr>
          </thead>


          <tbody>

            {cargando && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: 'center',
                    padding: '32px',
                  }}
                >
                  Cargando proveedores...
                </td>
              </tr>
            )}


            {!cargando &&
              proveedoresFiltrados
                .length === 0 && (

              <tr>
                <td
                  colSpan={8}
                  style={{
                    textAlign: 'center',
                    padding: '40px',
                  }}
                >
                  No se encontraron proveedores.
                </td>
              </tr>

            )}


            {!cargando &&
              proveedoresFiltrados.map(
                proveedor => (

              <tr key={proveedor.id}>

                <td>
                  {proveedor.codigo}
                </td>


                <td>
                  <strong>
                    {proveedor.nombre}
                  </strong>

                  {proveedor.direccion && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#8a93a3',
                        marginTop: '3px',
                      }}
                    >
                      {proveedor.direccion}
                    </div>
                  )}
                </td>


                <td>
                  {proveedor.ruc || '—'}
                </td>


                <td>
                  {proveedor.contacto || '—'}
                </td>


                <td>
                  {proveedor.telefono || '—'}
                </td>


                <td>
                  {proveedor.email || '—'}
                </td>


                <td>
                  <span
                    className={
                      proveedor.activo
                        ? 'status-badge status-success'
                        : 'status-badge status-danger'
                    }
                  >
                    {proveedor.activo
                      ? 'Activo'
                      : 'Inactivo'}
                  </span>
                </td>


                <td>
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                    }}
                  >

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        abrirEditarProveedor(
                          proveedor,
                        )
                      }
                    >
                      Editar
                    </button>


                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void cambiarEstado(
                          proveedor,
                        )
                      }
                    >
                      {proveedor.activo
                        ? 'Desactivar'
                        : 'Activar'}
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