import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  errorRuc,
  mensajeIdentidad,
} from '../lib/identidad'


// ==========================================================
// PROPS
// ==========================================================

type SuppliersModuleProps = {
  roleCode: string
}


// ==========================================================
// TIPOS
// ==========================================================

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


type CompraProveedor = {
  id: number
  numero: string
  fecha_compra: string
  referencia_documento: string | null
  total: number
  estado: string
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


// ==========================================================
// UTILIDADES
// ==========================================================

function formatearCordobas(
  valor: number,
) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
    },
  ).format(valor)
}


function obtenerMensajeError(
  err: unknown,
  respaldo: string,
) {
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err
  ) {
    const mensaje =
      (
        err as {
          message?: unknown
        }
      ).message

    if (
      typeof mensaje ===
      'string'
    ) {
      return mensaje
    }
  }

  if (
    err instanceof Error
  ) {
    return err.message
  }

  return respaldo
}


// ==========================================================
// COMPONENTE
// ==========================================================

export default function SuppliersModule({
  roleCode,
}: SuppliersModuleProps) {
  /*
   * ÚNICAMENTE EL ENCARGADO DE COMPRAS
   * ADMINISTRA PROVEEDORES.
   *
   * Responsable y Gerencia:
   * solo consulta + historial.
   */
  const puedeAdministrar =
    roleCode ===
    'encargado_compras'


  // ========================================================
  // ESTADOS
  // ========================================================

  const [
    proveedores,
    setProveedores,
  ] =
    useState<
      Proveedor[]
    >([])


  const [
    busqueda,
    setBusqueda,
  ] =
    useState('')


  const [
    cargando,
    setCargando,
  ] =
    useState(true)


  const [
    guardando,
    setGuardando,
  ] =
    useState(false)


  const [
    error,
    setError,
  ] =
    useState('')


  const [
    mensaje,
    setMensaje,
  ] =
    useState('')


  const [
    mostrarFormulario,
    setMostrarFormulario,
  ] =
    useState(false)


  const [
    proveedorEditando,
    setProveedorEditando,
  ] =
    useState<
      Proveedor | null
    >(null)


  const [
    form,
    setForm,
  ] =
    useState<FormProveedor>(
      FORM_INICIAL,
    )


  const [
    proveedorHistorial,
    setProveedorHistorial,
  ] =
    useState<
      Proveedor | null
    >(null)


  const [
    comprasProveedor,
    setComprasProveedor,
  ] =
    useState<
      CompraProveedor[]
    >([])


  const [
    cargandoHistorial,
    setCargandoHistorial,
  ] =
    useState(false)


  const [
    errorHistorial,
    setErrorHistorial,
  ] =
    useState('')


  // ========================================================
  // CARGAR PROVEEDORES
  // ========================================================

  async function cargarProveedores() {
    try {
      setCargando(true)

      setError('')


      const {
        data,
        error,
      } =
        await supabase
          .from(
            'proveedores',
          )
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
          .order(
            'nombre',
            {
              ascending:
                true,
            },
          )


      if (error) {
        throw error
      }


      setProveedores(
        (
          data ??
          []
        ) as Proveedor[],
      )
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar los proveedores.',
        ),
      )
    } finally {
      setCargando(
        false,
      )
    }
  }


  useEffect(() => {
    void cargarProveedores()
  }, [])


  // ========================================================
  // ESTADÍSTICAS
  // ========================================================

  const activos =
    useMemo(
      () =>
        proveedores.filter(
          proveedor =>
            proveedor.activo,
        ).length,
      [
        proveedores,
      ],
    )


  const inactivos =
    proveedores.length -
    activos


  const conContacto =
    useMemo(
      () =>
        proveedores.filter(
          proveedor =>
            Boolean(
              proveedor.telefono?.trim() ||
              proveedor.email?.trim(),
            ),
        ).length,
      [
        proveedores,
      ],
    )


  // ========================================================
  // FILTRO
  // ========================================================

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
            proveedor.ruc ??
              '',
            proveedor.contacto ??
              '',
            proveedor.telefono ??
              '',
            proveedor.email ??
              '',
            proveedor.direccion ??
              '',
          ]
            .join(' ')
            .toLowerCase()


          return texto.includes(
            termino,
          )
        },
      )
    }, [
      proveedores,
      busqueda,
    ])


  // ========================================================
  // NUEVO PROVEEDOR
  // SOLO ENCARGADO
  // ========================================================

  function abrirNuevoProveedor() {
    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil solamente puede consultar proveedores.',
      )

      return
    }


    setProveedorEditando(
      null,
    )

    setForm(
      FORM_INICIAL,
    )

    setError('')
    setMensaje('')

    setMostrarFormulario(
      true,
    )
  }


  // ========================================================
  // EDITAR PROVEEDOR
  // SOLO ENCARGADO
  // ========================================================

  function abrirEditarProveedor(
    proveedor: Proveedor,
  ) {
    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil no tiene permisos para editar proveedores.',
      )

      return
    }


    setProveedorEditando(
      proveedor,
    )


    setForm({
      nombre:
        proveedor.nombre ??
        '',

      ruc:
        proveedor.ruc ??
        '',

      contacto:
        proveedor.contacto ??
        '',

      telefono:
        proveedor.telefono ??
        '',

      email:
        proveedor.email ??
        '',

      direccion:
        proveedor.direccion ??
        '',
    })


    setError('')
    setMensaje('')

    setMostrarFormulario(
      true,
    )
  }


  // ========================================================
  // CERRAR FORMULARIO
  // ========================================================

  function cerrarFormulario() {
    if (
      guardando
    ) {
      return
    }


    setMostrarFormulario(
      false,
    )

    setProveedorEditando(
      null,
    )

    setForm(
      FORM_INICIAL,
    )
  }


  // ========================================================
  // ACTUALIZAR FORMULARIO
  // ========================================================

  function actualizarCampo(
    campo:
      keyof FormProveedor,
    valor: string,
  ) {
    setForm(
      actual => ({
        ...actual,
        [campo]:
          valor,
      }),
    )
  }


  // ========================================================
  // GUARDAR PROVEEDOR
  // SOLO ENCARGADO
  // ========================================================

  async function guardarProveedor(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()


    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil no tiene permisos para administrar proveedores.',
      )

      return
    }


    try {
      setGuardando(
        true,
      )

      setError('')
      setMensaje('')


      const nombre =
        form.nombre.trim()


      if (
        nombre.length <
        2
      ) {
        throw new Error(
          'Ingrese un nombre válido para el proveedor.',
        )
      }


      // RUC: J + 13 dígitos o cédula (la base valida lo mismo)
      const problemaRuc =
        errorRuc(form.ruc, true)

      if (problemaRuc) {
        throw new Error(problemaRuc)
      }


      const payload = {
        nombre,

        ruc:
          form.ruc
            .trim() ||
          null,

        contacto:
          form.contacto
            .trim() ||
          null,

        telefono:
          form.telefono
            .trim() ||
          null,

        email:
          form.email
            .trim() ||
          null,

        direccion:
          form.direccion
            .trim() ||
          null,
      }


      // ====================================================
      // EDITAR
      // ====================================================

      if (
        proveedorEditando
      ) {
        const {
          error:
            actualizarError,
        } =
          await supabase
            .from(
              'proveedores',
            )
            .update(
              payload,
            )
            .eq(
              'id',
              proveedorEditando.id,
            )


        if (
          actualizarError
        ) {
          throw actualizarError
        }


        setMensaje(
          'Proveedor actualizado correctamente.',
        )
      } else {

        // ==================================================
        // CREAR
        // ==================================================

        const {
          error:
            insertarError,
        } =
          await supabase
            .from(
              'proveedores',
            )
            .insert(
              payload,
            )


        if (
          insertarError
        ) {
          throw insertarError
        }


        setMensaje(
          'Proveedor creado correctamente.',
        )
      }


      setMostrarFormulario(
        false,
      )

      setProveedorEditando(
        null,
      )

      setForm(
        FORM_INICIAL,
      )


      await cargarProveedores()
    } catch (err) {
      setError(
        mensajeIdentidad(
          obtenerMensajeError(
            err,
            'No fue posible guardar el proveedor.',
          ),
        ),
      )
    } finally {
      setGuardando(
        false,
      )
    }
  }


  // ========================================================
  // ACTIVAR / DESACTIVAR
  // SOLO ENCARGADO
  // ========================================================

  async function cambiarEstado(
    proveedor: Proveedor,
  ) {
    if (
      !puedeAdministrar
    ) {
      setError(
        'Este perfil no tiene permisos para cambiar el estado de proveedores.',
      )

      return
    }


    const accion =
      proveedor.activo
        ? 'desactivar'
        : 'activar'


    const confirmado =
      window.confirm(
        `¿Deseas ${accion} al proveedor ${proveedor.nombre}?`,
      )


    if (
      !confirmado
    ) {
      return
    }


    try {
      setError('')
      setMensaje('')


      const {
        error:
          actualizarError,
      } =
        await supabase
          .from(
            'proveedores',
          )
          .update({
            activo:
              !proveedor.activo,
          })
          .eq(
            'id',
            proveedor.id,
          )


      if (
        actualizarError
      ) {
        throw actualizarError
      }


      setMensaje(
        proveedor.activo
          ? 'Proveedor desactivado correctamente.'
          : 'Proveedor activado correctamente.',
      )


      await cargarProveedores()
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible actualizar el proveedor.',
        ),
      )
    }
  }


  // ========================================================
  // HISTORIAL DE COMPRAS
  // TODOS LOS ROLES CON ACCESO A PROVEEDORES
  // ========================================================

  async function abrirHistorialProveedor(
    proveedor: Proveedor,
  ) {
    try {
      setProveedorHistorial(
        proveedor,
      )

      setComprasProveedor(
        [],
      )

      setErrorHistorial(
        '',
      )

      setCargandoHistorial(
        true,
      )


      const {
        data,
        error,
      } =
        await supabase
          .from(
            'compras',
          )
          .select(`
            id,
            numero,
            fecha_compra,
            referencia_documento,
            total,
            estado
          `)
          .eq(
            'proveedor_id',
            proveedor.id,
          )
          .order(
            'fecha_compra',
            {
              ascending:
                false,
            },
          )
          .order(
            'id',
            {
              ascending:
                false,
            },
          )


      if (error) {
        throw error
      }


      setComprasProveedor(
        (
          data ??
          []
        ) as CompraProveedor[],
      )
    } catch (err) {
      setErrorHistorial(
        obtenerMensajeError(
          err,
          'No fue posible cargar el historial de compras.',
        ),
      )
    } finally {
      setCargandoHistorial(
        false,
      )
    }
  }


  function cerrarHistorialProveedor() {
    setProveedorHistorial(
      null,
    )

    setComprasProveedor(
      [],
    )

    setErrorHistorial(
      '',
    )
  }


  // ========================================================
  // INTERFAZ
  // ========================================================

  return (
    <div className="inventory-module">

      {/* ====================================================
          ENCABEZADO
      ==================================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            GESTIÓN DE COMPRAS
          </span>

          <h2>
            Proveedores
          </h2>

          <p>
            {puedeAdministrar
              ? 'Administración del catálogo de proveedores de Casa Hogar.'
              : 'Consulta del catálogo de proveedores de Casa Hogar.'}
          </p>
        </div>


        <div
          style={{
            display:
              'flex',
            gap:
              '10px',
            alignItems:
              'center',
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void cargarProveedores()
            }
            disabled={
              cargando
            }
          >
            ↻ Actualizar
          </button>


          {puedeAdministrar && (
            <button
              type="button"
              className="primary-button"
              onClick={
                abrirNuevoProveedor
              }
            >
              + Nuevo proveedor
            </button>
          )}
        </div>
      </div>


      {/* ====================================================
          ESTADÍSTICAS
      ==================================================== */}

      <div className="inventory-stats">
        <div className="inventory-stat-card">
          <span>
            PROVEEDORES
          </span>

          <strong>
            {
              proveedores.length
            }
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
            {
              activos
            }
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
            {
              inactivos
            }
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
            {
              conContacto
            }
          </strong>

          <small>
            teléfono o correo
          </small>
        </div>
      </div>


      {/* ====================================================
          MENSAJES
      ==================================================== */}

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


      {/* ====================================================
          HISTORIAL DEL PROVEEDOR
      ==================================================== */}

      {proveedorHistorial && (
        <section className="inventory-toolbar">
          <div
            style={{
              width:
                '100%',
            }}
          >
            <div
              style={{
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'flex-start',
                gap:
                  '20px',
                marginBottom:
                  '18px',
              }}
            >
              <div>
                <span className="panel-label">
                  HISTORIAL DE COMPRAS
                </span>

                <h2>
                  {
                    proveedorHistorial.nombre
                  }
                </h2>

                <p>
                  Compras registradas para el proveedor{' '}
                  {
                    proveedorHistorial.codigo
                  }.
                </p>
              </div>


              <button
                type="button"
                className="secondary-button"
                onClick={
                  cerrarHistorialProveedor
                }
              >
                ✕ Cerrar
              </button>
            </div>


            {cargandoHistorial ? (
              <div className="inventory-empty">
                Cargando historial...
              </div>
            ) : errorHistorial ? (
              <div className="error-message">
                {
                  errorHistorial
                }
              </div>
            ) : comprasProveedor.length ===
              0 ? (
              <div className="inventory-empty">
                Este proveedor todavía no tiene compras registradas.
              </div>
            ) : (
              <div className="inventory-table-wrapper">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>
                        NÚMERO
                      </th>

                      <th>
                        FECHA
                      </th>

                      <th>
                        REFERENCIA
                      </th>

                      <th>
                        TOTAL
                      </th>

                      <th>
                        ESTADO
                      </th>
                    </tr>
                  </thead>


                  <tbody>
                    {comprasProveedor.map(
                      compra => (
                        <tr
                          key={
                            compra.id
                          }
                        >
                          <td>
                            {
                              compra.numero
                            }
                          </td>

                          <td>
                            {
                              compra.fecha_compra
                            }
                          </td>

                          <td>
                            {
                              compra.referencia_documento ||
                              '—'
                            }
                          </td>

                          <td>
                            {formatearCordobas(
                              Number(
                                compra.total ??
                                  0,
                              ),
                            )}
                          </td>

                          <td>
                            <span
                              className={
                                compra.estado ===
                                'anulada'
                                  ? 'status-badge status-danger'
                                  : 'status-badge status-success'
                              }
                            >
                              {
                                compra.estado
                              }
                            </span>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}


      {/* ====================================================
          FORMULARIO
          SOLO ENCARGADO DE COMPRAS
      ==================================================== */}

      {mostrarFormulario &&
        puedeAdministrar && (
          <div className="inventory-toolbar">
            <div
              style={{
                width:
                  '100%',
              }}
            >
              <div
                style={{
                  display:
                    'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'flex-start',
                  gap:
                    '20px',
                  marginBottom:
                    '22px',
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
                    Completa los datos del proveedor.
                  </p>
                </div>


                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    cerrarFormulario
                  }
                  disabled={
                    guardando
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
                    display:
                      'grid',
                    gridTemplateColumns:
                      'repeat(3, minmax(0, 1fr))',
                    gap:
                      '16px',
                  }}
                >

                  {/* NOMBRE */}

                  <label>
                    Nombre *

                    <input
                      type="text"
                      value={
                        form.nombre
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'nombre',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="Nombre del proveedor"
                      required
                    />
                  </label>


                  {/* RUC */}

                  <label>
                    RUC

                    <input
                      type="text"
                      value={
                        form.ruc
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'ruc',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="Número RUC"
                    />
                  </label>


                  {/* CONTACTO */}

                  <label>
                    Persona de contacto

                    <input
                      type="text"
                      value={
                        form.contacto
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'contacto',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="Nombre del contacto"
                    />
                  </label>


                  {/* TELÉFONO */}

                  <label>
                    Teléfono

                    <input
                      type="text"
                      value={
                        form.telefono
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'telefono',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="Teléfono"
                    />
                  </label>


                  {/* CORREO */}

                  <label>
                    Correo

                    <input
                      type="email"
                      value={
                        form.email
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'email',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="correo@proveedor.com"
                    />
                  </label>


                  {/* DIRECCIÓN */}

                  <label>
                    Dirección

                    <input
                      type="text"
                      value={
                        form.direccion
                      }
                      onChange={
                        event =>
                          actualizarCampo(
                            'direccion',
                            event
                              .target
                              .value,
                          )
                      }
                      placeholder="Dirección"
                    />
                  </label>
                </div>


                <div
                  style={{
                    display:
                      'flex',
                    justifyContent:
                      'flex-end',
                    gap:
                      '10px',
                    marginTop:
                      '22px',
                  }}
                >
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={
                      cerrarFormulario
                    }
                    disabled={
                      guardando
                    }
                  >
                    Cancelar
                  </button>


                  <button
                    type="submit"
                    className="primary-button"
                    disabled={
                      guardando
                    }
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


      {/* ====================================================
          BUSCADOR
      ==================================================== */}

      <div
        style={{
          display:
            'flex',
          alignItems:
            'center',
          justifyContent:
            'space-between',
          gap:
            '20px',
        }}
      >
        <input
          type="search"
          className="inventory-search"
          placeholder="⌕  Buscar por código, proveedor, RUC, contacto..."
          value={
            busqueda
          }
          onChange={
            event =>
              setBusqueda(
                event
                  .target
                  .value,
              )
          }
        />


        <span
          style={{
            fontSize:
              '14px',
            color:
              '#7b8494',
          }}
        >
          {
            proveedoresFiltrados.length
          }{' '}

          {proveedoresFiltrados.length ===
          1
            ? 'proveedor'
            : 'proveedores'}
        </span>
      </div>


      {/* ====================================================
          TABLA
      ==================================================== */}

      <div className="inventory-table-wrapper">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>
                CÓDIGO
              </th>

              <th>
                PROVEEDOR
              </th>

              <th>
                RUC
              </th>

              <th>
                CONTACTO
              </th>

              <th>
                TELÉFONO
              </th>

              <th>
                CORREO
              </th>

              <th>
                ESTADO
              </th>

              <th>
                ACCIONES
              </th>
            </tr>
          </thead>


          <tbody>
            {cargando && (
              <tr>
                <td
                  colSpan={
                    8
                  }
                  style={{
                    textAlign:
                      'center',
                    padding:
                      '32px',
                  }}
                >
                  Cargando proveedores...
                </td>
              </tr>
            )}


            {!cargando &&
              proveedoresFiltrados.length ===
                0 && (
                <tr>
                  <td
                    colSpan={
                      8
                    }
                    style={{
                      textAlign:
                        'center',
                      padding:
                        '40px',
                    }}
                  >
                    No se encontraron proveedores.
                  </td>
                </tr>
              )}


            {!cargando &&
              proveedoresFiltrados.map(
                proveedor => (
                  <tr
                    key={
                      proveedor.id
                    }
                  >
                    <td>
                      {
                        proveedor.codigo
                      }
                    </td>


                    <td>
                      <strong>
                        {
                          proveedor.nombre
                        }
                      </strong>

                      {proveedor.direccion && (
                        <div
                          style={{
                            fontSize:
                              '13px',
                            color:
                              '#8a93a3',
                            marginTop:
                              '3px',
                          }}
                        >
                          {
                            proveedor.direccion
                          }
                        </div>
                      )}
                    </td>


                    <td>
                      {
                        proveedor.ruc ||
                        '—'
                      }
                    </td>


                    <td>
                      {
                        proveedor.contacto ||
                        '—'
                      }
                    </td>


                    <td>
                      {
                        proveedor.telefono ||
                        '—'
                      }
                    </td>


                    <td>
                      {
                        proveedor.email ||
                        '—'
                      }
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
                          display:
                            'flex',
                          gap:
                            '8px',
                          flexWrap:
                            'wrap',
                        }}
                      >

                        {/* HISTORIAL:
                            TODOS LOS ROLES */}

                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            void abrirHistorialProveedor(
                              proveedor,
                            )
                          }
                        >
                          Historial
                        </button>


                        {/* SOLO ENCARGADO */}

                        {puedeAdministrar && (
                          <>
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
          </tbody>
        </table>
      </div>
    </div>
  )
}