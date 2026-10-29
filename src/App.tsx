import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from './lib/supabase'
import { mensajeIntentoAcceso } from './lib/accesos'
import {
  registrarActividad,
  useCierrePorInactividad,
} from './lib/inactividad'

import {
  menusByRole,
  type RoleCode,
} from './config/roleMenus'

import InventoryModule from './modules/InventoryModule'
import ProductsModule from './modules/ProductsModule'
import MovementsModule from './modules/MovementsModule'
import ReplenishmentModule from './modules/ReplenishmentModule'
import SalesModule from './modules/SalesModule'
import ClientsModule from './modules/ClientsModule'
import QuotesModule from './modules/QuotesModule'
import SalesReturnsModule from './modules/SalesReturnsModule'
import SalesHistoryModule from './modules/SalesHistoryModule'
import OnlineOrdersModule from './modules/OnlineOrdersModule'
import AccountsReceivableModule from './modules/AccountsReceivableModule'
import CashModule from './modules/CashModule'
import OwnerDashboardModule from './modules/OwnerDashboardModule'
import OwnerReportsModule from './modules/OwnerReportsModule'
import OwnerAlertsModule from './modules/OwnerAlertsModule'
import SupervisionModule from './modules/SupervisionModule'
import SupportModule from './modules/SupportModule'
import AccountPasswordModule from './modules/AccountPasswordModule'
import Storefront from './modules/Storefront'
import logoCasaHogar from './assets/casa-hogar-logo-horizontal.png'
import SuppliersModule from './modules/SuppliersModule'
import PurchasesModule from './modules/PurchasesModule'
import PurchaseReceptionModule from './modules/PurchaseReceptionModule'
import PurchaseReturnsModule from './modules/PurchaseReturnsModule'

import './App.css'
import './styles/tema-casa-hogar.css'


// =====================================================
// TIPOS
// =====================================================

type Rol = {
  codigo: string
  nombre: string
}

type Perfil = {
  id: string
  nombre_completo: string | null
  activo: boolean
  roles: Rol | null
}

type PerfilRespuesta = {
  id: string
  nombre_completo: string | null
  activo: boolean
  roles: Rol | Rol[] | null
}


// =====================================================
// UTILIDADES
// =====================================================

function obtenerRol(
  roles: Rol | Rol[] | null,
): Rol | null {
  if (!roles) {
    return null
  }

  if (Array.isArray(roles)) {
    return roles[0] ?? null
  }

  return roles
}


function getMenuIcon(id: string) {
  const paths: Record<string, string> = {
    dashboard:
      'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',

    reportes:
      'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',

    inventario:
      'M3 7 12 2l9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10',

    productos:
      'M3 4h9l9 9-8 8-9-9z M8 8h.01',

    movimientos:
      'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',

    reposicion:
      'M20 11a8 8 0 0 0-14-5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14 5l2-2 M20 20v-4h-4',

    compras:
      'M5 8h14l1 13H4L5 8z M9 9V6a3 3 0 0 1 6 0v3',

    proveedores:
      'M3 6h11v11H3z M14 10h4l3 3v4h-7z M6 18a2 2 0 1 0 4 0 M16 18a2 2 0 1 0 4 0',

    recepciones:
      'M4 7 12 3l8 4v10l-8 4-8-4z M4 7l8 5 8-5 M12 12v9 M8 15l2 2 4-4',

    devoluciones:
      'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 5 5v1 M20 15l-4-4 M20 15l-4 4',

    ventas:
      'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',

    caja:
      'M3 6h17v14H3z M3 9h17 M16 13h5v4h-5a2 2 0 0 1 0-4z',

    alertas:
      'M12 3 2 21h20L12 3z M12 9v5 M12 18h.01',

    usuarios:
      'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 3a4 4 0 0 1 0 8 M22 20v-2a4 4 0 0 0-3-3.87',

    roles:
      'M12 2 4 5v6c0 5 3.4 8.8 8 11 4.6-2.2 8-6 8-11V5z M9 12l2 2 4-4',

    auditoria:
      'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',

    configuracion:
      'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  }

  const key = id
    .replace('-consulta', '')
    .replace('-modulo', '')

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          paths[key] ??
          paths.dashboard
        }
      />
    </svg>
  )
}


// =====================================================
// APP
// =====================================================

function InternalSystemApp({
  navigate,
}: {
  navigate: (path: string) => void
}) {
  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  const [mensaje, setMensaje] =
    useState('')

  const [perfil, setPerfil] =
    useState<Perfil | null>(
      null,
    )

  const [userId, setUserId] =
    useState<string | null>(
      null,
    )

  const [cargando, setCargando] =
    useState(true)

  const [
    menuAbierto,
    setMenuAbierto,
  ] = useState(false)

  const [
    mostrarClave,
    setMostrarClave,
  ] = useState(false)

  const [
    moduloActivo,
    setModuloActivo,
  ] = useState('')

  const [
    gruposAbiertos,
    setGruposAbiertos,
  ] = useState<Record<string, boolean>>({})

  const [
    cambiandoClave,
    setCambiandoClave,
  ] = useState(false)


  // ===================================================
  // ROL Y MENÚ ACTUAL
  // ===================================================

  const rolActual =
    perfil?.roles ?? null

  const menu =
    rolActual
      ? menusByRole[
          rolActual.codigo as RoleCode
        ] ?? []
      : []

  /*
   * Los elementos con children son grupos.
   * Los elementos sin children son pantallas navegables.
   */
  const itemsNavegables =
    menu.flatMap(item =>
      item.children?.length
        ? item.children
        : [item],
    )

  const moduloSeleccionado =
    itemsNavegables.find(
      item =>
        item.id === moduloActivo,
    ) ??
    itemsNavegables[0]

  const grupoSeleccionado =
    menu.find(item =>
      item.children?.some(
        child =>
          child.id ===
          moduloSeleccionado?.id,
      ),
    ) ?? null

  const moduloIdActual =
    moduloSeleccionado?.id ?? ''

  const esConsultaPorRol =
    (
      rolActual?.codigo === 'gerencia' &&
      moduloIdActual !== 'dashboard'
    ) ||
    (
      rolActual?.codigo === 'responsable_comercial' &&
      [
        'clientes',
        'cotizaciones',
        'ventas',
        'pedidos-en-linea',
        'cuentas-por-cobrar',
        'historial-ventas',
      ].includes(moduloIdActual)
    ) ||
    (
      rolActual?.codigo === 'vendedor' &&
      moduloIdActual === 'historial-ventas'
    )

  const esConsulta =
    (
      moduloSeleccionado
        ?.id
        .endsWith('-consulta') ??
      false
    ) ||
    esConsultaPorRol


  // ===================================================
  // AGRUPACIÓN DE PANTALLAS
  // ===================================================

  const modulosInventario = [
    'inventario',
    'inventario-consulta',
  ]

  const modulosProductos = [
    'productos',
    'productos-consulta',
  ]

  const modulosProveedores = [
    'proveedores',
    'proveedores-consulta',
  ]

  const modulosCompras = [
  'compras',
  'compras-consulta',
  'ordenes-compra',
  'autorizacion-compras',
  'historial-compras',
  ]

  const modulosMovimientos = [
    'movimientos',
    'movimientos-consulta',
  ]

  const modulosRecepciones = [
    'recepciones',
    'recepciones-consulta',
  ]

  const modulosDevoluciones = [
    'devoluciones',
    'devoluciones-consulta',
  ]

  const mostrarInventario =
    moduloSeleccionado
      ? modulosInventario.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarProductos =
    moduloSeleccionado
      ? modulosProductos.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarProveedores =
    moduloSeleccionado
      ? modulosProveedores.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarCompras =
    moduloSeleccionado
      ? modulosCompras.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarMovimientos =
    moduloSeleccionado
      ? modulosMovimientos.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarRecepciones =
    moduloSeleccionado
      ? modulosRecepciones.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarDevoluciones =
    moduloSeleccionado
      ? modulosDevoluciones.includes(
          moduloSeleccionado.id,
        )
      : false


  // ===================================================
  // RECUPERAR SESIÓN
  // ===================================================

  useEffect(() => {
    async function obtenerSesionInicial() {
      const {
        data: { session },
      } =
        await supabase.auth
          .getSession()

      setUserId(
        session?.user.id ??
          null,
      )

      if (!session) {
        setCargando(false)
      }
    }

    void obtenerSesionInicial()

    const {
      data: { subscription },
    } =
      supabase.auth
        .onAuthStateChange(
          (_event, session) => {
            setUserId(
              session?.user.id ??
                null,
            )

            if (!session) {
              setPerfil(null)
              setModuloActivo('')
              setGruposAbiertos({})
              setCargando(false)
            }
          },
        )

    return () => {
      subscription.unsubscribe()
    }
  }, [])


  // ===================================================
  // CARGAR PERFIL Y ROL
  // ===================================================

  useEffect(() => {
    if (!userId) {
      return
    }

    async function cargarPerfil() {
      setCargando(true)

      const {
        data,
        error,
      } =
        await supabase
          .from('profiles')
          .select(`
            id,
            nombre_completo,
            activo,
            roles (
              codigo,
              nombre
            )
          `)
          .eq(
            'id',
            userId,
          )
          .single()

      if (error) {
        const {
          data: tipoCuenta,
        } =
          await supabase.rpc(
            'tipo_cuenta_actual',
          )

        const tipo = String(
          tipoCuenta ??
          'sin_perfil',
        )

        /*
         * Sesión de un cliente de la tienda (por ejemplo, abierta en
         * otra pestaña: Supabase comparte la sesión en todo el sitio).
         * No se cierra con signOut(): eso sacaría al cliente también de
         * la tienda. Solo se le niega el sistema interno; el formulario
         * de login ya rechaza a los clientes en iniciarSesion().
         */
        if (
          tipo ===
          'cliente_web'
        ) {
          setPerfil(null)
          setUserId(null)

          setMensaje(
            'La sesión abierta en este navegador es de un cliente de la tienda en línea. Ingresá con una cuenta del personal para usar el sistema interno.',
          )

          navigate('/login')
          setCargando(false)

          return
        }

        setMensaje(
          `No fue posible validar el acceso interno: ${error.message}`,
        )

        setPerfil(null)
        setCargando(false)

        return
      }

      const respuesta =
        data as unknown as PerfilRespuesta

      const perfilData: Perfil = {
        id: respuesta.id,

        nombre_completo:
          respuesta.nombre_completo,

        activo:
          respuesta.activo,

        roles:
          obtenerRol(
            respuesta.roles,
          ),
      }

      if (!perfilData.activo) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)

        setMensaje(
          'Este usuario se encuentra inactivo.',
        )

        setCargando(false)

        return
      }

      if (!perfilData.roles) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)

        setMensaje(
          'Este usuario no tiene un rol asignado.',
        )

        setCargando(false)

        return
      }

      setPerfil(perfilData)
      setModuloActivo('')
      setGruposAbiertos({})
      setMensaje('')
      setCargando(false)
    }

    void cargarPerfil()
  }, [userId])


  // ===================================================
  // INICIAR SESIÓN
  // ===================================================

  async function iniciarSesion(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setMensaje('')
    setCargando(true)

    /*
     * Primero se pasa por intentar_acceso(): la base verifica la
     * contraseña, cuenta los intentos fallidos y bloquea la cuenta
     * 15 minutos tras 5 seguidos. Solo si lo permite se inicia sesión.
     */
    const {
      data: intento,
      error: intentoError,
    } =
      await supabase.rpc(
        'intentar_acceso',
        {
          p_correo: email,
          p_clave: password,
        },
      )

    const rechazo = mensajeIntentoAcceso(
      intento,
      intentoError,
      'Si no recuerdas tu contraseña, Soporte TI puede desbloquear la cuenta y darte una temporal.',
    )

    if (rechazo) {
      setMensaje(rechazo)
      setCargando(false)

      return
    }

    const {
      data,
      error,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password,
        })

    if (error) {
      setMensaje(
        'Correo o contraseña incorrectos.',
      )

      setCargando(false)

      return
    }

    registrarActividad()

    const {
      data: tipoCuenta,
      error: tipoError,
    } =
      await supabase.rpc(
        'tipo_cuenta_actual',
      )

    if (tipoError) {
      await supabase.auth
        .signOut()

      setMensaje(
        'No fue posible validar el tipo de cuenta.',
      )

      setCargando(false)

      return
    }

    const tipo = String(
      tipoCuenta ??
      'sin_perfil',
    )

    if (
      tipo !== 'personal'
    ) {
      await supabase.auth
        .signOut()

      setUserId(null)

      if (
        tipo === 'cliente_web'
      ) {
        setMensaje(
          'Esta cuenta pertenece a la tienda en línea. El sistema interno es exclusivo para el personal.',
        )
      } else {
        setMensaje(
          'Esta cuenta no está habilitada para ingresar al sistema interno.',
        )
      }

      setCargando(false)

      return
    }

    setUserId(
      data.user.id,
    )

    setPassword('')
    navigate('/app')
  }


  // ===================================================
  // CERRAR SESIÓN
  // ===================================================

  async function cerrarSesion() {
    const { error } =
      await supabase.auth
        .signOut()

    if (error) {
      setMensaje(
        `Error al cerrar sesión: ${error.message}`,
      )

      return
    }

    setPerfil(null)
    setUserId(null)

    setEmail('')
    setPassword('')
    setModuloActivo('')
    setGruposAbiertos({})
    setMensaje('')
    navigate('/login')
  }


  // ===================================================
  // CIERRE POR INACTIVIDAD (1 hora sin usar el sistema)
  // ===================================================

  async function cerrarPorInactividad() {
    await supabase.auth.signOut()

    setPerfil(null)
    setUserId(null)

    setPassword('')
    setModuloActivo('')
    setGruposAbiertos({})
    setCambiandoClave(false)
    setMensaje(
      'Tu sesión se cerró porque pasó 1 hora sin actividad. Vuelve a ingresar.',
    )
    navigate('/login')
  }

  const {
    segundosRestantes: segundosInactividad,
    seguirConectado,
  } =
    useCierrePorInactividad({
      activo: Boolean(perfil),
      minutos: 60,
      avisoSegundos: 120,
      alCerrar: () => void cerrarPorInactividad(),
    })


  // ===================================================
  // CONTROL DEL MENÚ DESPLEGABLE
  // ===================================================

  function alternarGrupo(
    id: string,
    abiertoPorDefecto: boolean,
  ) {
    setGruposAbiertos(
      estadoActual => ({
        ...estadoActual,

        [id]:
          estadoActual[id] ??
          abiertoPorDefecto
            ? !(estadoActual[id] ??
                abiertoPorDefecto)
            : true,
      }),
    )
  }


  // ===================================================
  // RENDERIZAR MÓDULO ACTUAL
  // ===================================================

  function renderModulo() {
    if (!moduloSeleccionado) {
      return null
    }


    // -------------------------------------------------
    // INVENTARIO
    // -------------------------------------------------

    if (mostrarInventario) {
      return (
        <InventoryModule />
      )
    }


    // -------------------------------------------------
    // PRODUCTOS
    // -------------------------------------------------

    if (mostrarProductos) {
      return (
    <ProductsModule
      roleCode={
        rolActual?.codigo ??
        ''
      }
    />
  )
    }


    // -------------------------------------------------
    // MOVIMIENTOS
    // -------------------------------------------------

    if (mostrarMovimientos) {
      return (
        <MovementsModule
          soloConsulta={esConsulta}
        />
      )
    }


    // -------------------------------------------------
    // REPOSICIÓN (consulta del Bodeguero; Compras ve la
    // misma lista al registrar una compra)
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'reposicion'
    ) {
      return (
        <ReplenishmentModule />
      )
    }


    // -------------------------------------------------
    // CLIENTES
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'clientes'
    ) {
      return (
        <ClientsModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // COTIZACIONES
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'cotizaciones'
    ) {
      return (
        <QuotesModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // HISTORIAL DE VENTAS
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'historial-ventas'
    ) {
      return (
        <SalesHistoryModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // PEDIDOS EN LÍNEA
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'pedidos-en-linea'
    ) {
      return (
        <OnlineOrdersModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // CUENTAS POR COBRAR
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'cuentas-por-cobrar'
    ) {
      return (
        <AccountsReceivableModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // DEVOLUCIONES DE VENTA
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'devoluciones-venta'
    ) {
      return (
        <SalesReturnsModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // VENTAS
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'ventas'
    ) {
      return (
        <SalesModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // CAJA
    // -------------------------------------------------

    const vistasCaja = [
      'caja',
      'caja-apertura',
      'caja-cobros',
      'caja-movimientos',
      'caja-arqueo',
      'caja-cierre',
      'caja-devoluciones',
      'caja-historial',
    ]

    if (
      vistasCaja.includes(
        moduloSeleccionado.id
      )
    ) {
      return (
        <CashModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
          vista={
            moduloSeleccionado.id
          }
        />
      )
    }


    // -------------------------------------------------
    // COMPRAS
    // -------------------------------------------------

    if (mostrarCompras) {
  return (
    <PurchasesModule
      roleCode={
        rolActual?.codigo ?? ''
      }
      vista={
        moduloSeleccionado.id
      }
    />
  )
}


    // -------------------------------------------------
    // RECEPCIÓN DE PRODUCTOS
    // -------------------------------------------------

    if (mostrarRecepciones) {
      return (
        <PurchaseReceptionModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // DEVOLUCIONES DE COMPRA
    // -------------------------------------------------

    if (mostrarDevoluciones) {
      return (
        <PurchaseReturnsModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // PROVEEDORES
    // -------------------------------------------------

    if (mostrarProveedores) {
      return (
        <SuppliersModule
  roleCode={
    rolActual?.codigo ??
    ''
  }
/>
      )
    }


    // -------------------------------------------------
    // DASHBOARD DEL PROPIETARIO
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'dashboard'
    ) {
      return (
        <OwnerDashboardModule />
      )
    }


    // -------------------------------------------------
    // REPORTES Y ANÁLISIS DEL PROPIETARIO
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'reportes-analisis'
    ) {
      return (
        <OwnerReportsModule />
      )
    }


    // -------------------------------------------------
    // PANEL DE SUPERVISIÓN (GERENCIA)
    // Cada alerta abre el módulo de consulta donde se ve.
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'supervision'
    ) {
      return (
        <SupervisionModule
          onAbrirModulo={id => {
            setModuloActivo(id)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )
    }


    // -------------------------------------------------
    // REPORTES OPERATIVOS (GERENCIA)
    // Mismo análisis de solo consulta que el Propietario;
    // reportes_propietario() admite ambos roles.
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'reportes'
    ) {
      return (
        <OwnerReportsModule />
      )
    }


    // -------------------------------------------------
    // SOPORTE TI
    // -------------------------------------------------

    const vistasSoporte = [
      'usuarios',
      'roles',
      'auditoria',
      'configuracion',
    ]

    if (
      vistasSoporte.includes(
        moduloSeleccionado.id,
      )
    ) {
      return (
        <SupportModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
          vista={
            moduloSeleccionado.id
          }
        />
      )
    }


    // -------------------------------------------------
    // ALERTAS / RECOMENDACIONES DEL PROPIETARIO
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'alertas-recomendaciones'
    ) {
      return (
        <OwnerAlertsModule />
      )
    }


    // -------------------------------------------------
    // MÓDULO TODAVÍA NO IMPLEMENTADO
    // -------------------------------------------------

    return (
      <>
        <section className="grid">
          <article className="card">
            <div className="card-eyebrow">
              Módulo activo
            </div>

            <div className="card-module">
              <div className="card-icon">
                {getMenuIcon(
                  moduloSeleccionado.id,
                )}
              </div>

              <div>
                <h2 className="card-module-name">
                  {
                    moduloSeleccionado.nombre
                  }
                </h2>

                <p className="card-module-desc">
                  Habilitado para el perfil de{' '}

                  <strong>
                    {rolActual?.nombre}
                  </strong>

                  . Las funciones se incorporarán conforme avance el desarrollo.
                </p>
              </div>
            </div>

            <div className="card-stats">
              <div>
                <span className="stat-label">
                  Acceso
                </span>

                <strong className="stat-value stat-value--ok">
                  Autorizado
                </strong>
              </div>

              <div>
                <span className="stat-label">
                  Estado
                </span>

                <strong className="stat-value">
                  Preparado
                </strong>
              </div>
            </div>
          </article>

          <article className="card card--side">
            <div className="card-eyebrow">
              Módulos disponibles
            </div>

            <div className="card-count">
              {itemsNavegables.length}
            </div>

            <div className="mod-list">
              {itemsNavegables.map(
                item => (
                  <div
                    key={
                      item.id
                    }
                    className="mod-item"
                  >
                    <span className="mod-icon">
                      {getMenuIcon(
                        item.id,
                      )}
                    </span>

                    <span>
                      {item.nombre}
                    </span>
                  </div>
                ),
              )}
            </div>
          </article>
        </section>

        <section className="workspace">
          <div className="workspace-head">
            <h2 className="workspace-title">
              {
                moduloSeleccionado.nombre
              }
            </h2>

            <span className="workspace-tag">
              Preparado
            </span>
          </div>

          <div className="workspace-body">
            <div className="workspace-icon">
              {getMenuIcon(
                moduloSeleccionado.id,
              )}
            </div>

            <div>
              <h3 className="workspace-h3">
                Módulo listo para desarrollo
              </h3>

              <p className="workspace-p">
                Aquí se integrarán las funciones de{' '}

                <strong>
                  {
                    moduloSeleccionado.nombre
                  }
                </strong>{' '}

                cuando corresponda dentro del plan de desarrollo.
              </p>
            </div>
          </div>
        </section>
      </>
    )
  }


  // ===================================================
  // PANTALLA DE CARGA
  // ===================================================

  if (cargando) {
    return (
      <div className="splash splash--brand">
        <div className="splash-ring" />

        <p className="splash-text">
          Cargando sistema...
        </p>
      </div>
    )
  }


  // ===================================================
  // LOGIN INTERNO
  // ===================================================

  if (
    !perfil ||
    !rolActual
  ) {
    return (
      <div className="auth-page auth-page--internal">
        <main className="auth-card auth-card--brand">
          <img
            className="auth-logo"
            src={logoCasaHogar}
            alt="Ferretería Casa Hogar"
          />

          <div className="auth-heading">
            <span className="auth-badge"><i /> Sistema interno</span>
            <h1>Ingresa con tu cuenta del personal</h1>
            <p className="auth-sub">
              Compras, inventario, ventas, caja y reportes.
            </p>
          </div>

          <form
            className="auth-form"
            onSubmit={iniciarSesion}
          >
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="usuario@casahogar.test"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <div className="password-field">
                <input
                  id="password"
                  type={mostrarClave ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setMostrarClave(!mostrarClave)}
                  aria-label={mostrarClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {mostrarClave ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            {mensaje && (
              <div className="auth-error">{mensaje}</div>
            )}

            <button type="submit" className="auth-btn">
              Ingresar
            </button>
          </form>

          <div className="auth-note">
            <span>
              ¿Olvidaste tu contraseña? Pide una temporal a Soporte TI.
            </span>

            <span>
              ¿Eres cliente?{' '}
              <button
                type="button"
                className="auth-link"
                onClick={() => navigate('/tienda')}
              >
                Ir a la tienda en línea
              </button>
            </span>
          </div>
        </main>
      </div>
    )
  }


  // ===================================================
  // SISTEMA PRINCIPAL
  // ===================================================

  return (
    <div className="shell">
      {menuAbierto && (
        <button
          className="nav-backdrop"
          type="button"
          aria-label="Cerrar menú"
          onClick={() =>
            setMenuAbierto(false)
          }
        />
      )}

      <aside
        className={`nav ${
          menuAbierto
            ? 'nav--open'
            : ''
        }`}
      >
        <div className="nav-brand nav-brand--logo">
          <img
            className="nav-logo"
            src={logoCasaHogar}
            alt="Ferretería Casa Hogar"
          />

          <span className="nav-brand-sub">
            Sistema de gestión
          </span>
        </div>

        <span className="nav-section-label">
          MENÚ PRINCIPAL
        </span>

        <nav
          className="nav-menu"
          aria-label="Menú principal"
        >
          {menu.map(
            item => {
              const tieneSubmenu =
                Boolean(
                  item.children?.length,
                )

              /*
               * ELEMENTO NORMAL
               */
              if (!tieneSubmenu) {
                const activo =
                  moduloSeleccionado
                    ?.id ===
                  item.id

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      activo
                        ? 'nav-item nav-item--on'
                        : 'nav-item'
                    }
                    onClick={() => {
                      setModuloActivo(
                        item.id,
                      )

                      setCambiandoClave(false)

                      setMenuAbierto(
                        false,
                      )
                    }}
                    aria-current={
                      activo
                        ? 'page'
                        : undefined
                    }
                  >
                    <span className="nav-icon">
                      {getMenuIcon(
                        item.id,
                      )}
                    </span>

                    <span>
                      {item.nombre}
                    </span>
                  </button>
                )
              }

              /*
               * GRUPO DESPLEGABLE
               */
              const grupoActivo =
                item.children?.some(
                  child =>
                    child.id ===
                    moduloSeleccionado
                      ?.id,
                ) ?? false

              const estaAbierto =
                gruposAbiertos[
                  item.id
                ] ??
                grupoActivo

              return (
                <div
                  className="nav-group"
                  key={item.id}
                >
                  <button
                    type="button"
                    className={
                      grupoActivo
                        ? 'nav-item nav-item--group nav-item--on'
                        : 'nav-item nav-item--group'
                    }
                    onClick={() =>
                      alternarGrupo(
                        item.id,
                        grupoActivo,
                      )
                    }
                    aria-expanded={
                      estaAbierto
                    }
                  >
                    <span className="nav-icon">
                      {getMenuIcon(
                        item.id,
                      )}
                    </span>

                    <span>
                      {item.nombre}
                    </span>

                    <span
                      className={`nav-chevron ${
                        estaAbierto
                          ? 'nav-chevron--open'
                          : ''
                      }`}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  </button>

                  {estaAbierto && (
                    <div className="nav-submenu">
                      {item.children?.map(
                        child => {
                          const activo =
                            moduloSeleccionado
                              ?.id ===
                            child.id

                          return (
                            <button
                              key={
                                child.id
                              }
                              type="button"
                              className={
                                activo
                                  ? 'nav-item nav-subitem nav-item--on'
                                  : 'nav-item nav-subitem'
                              }
                              onClick={() => {
                                setModuloActivo(
                                  child.id,
                                )

                                setCambiandoClave(false)

                                setMenuAbierto(
                                  false,
                                )
                              }}
                              aria-current={
                                activo
                                  ? 'page'
                                  : undefined
                              }
                            >
                              <span className="nav-icon">
                                {getMenuIcon(
                                  child.id,
                                )}
                              </span>

                              <span>
                                {
                                  child.nombre
                                }
                              </span>
                            </button>
                          )
                        },
                      )}
                    </div>
                  )}
                </div>
              )
            },
          )}
        </nav>

        <div className="nav-foot">
          <div className="nav-user">
            <div className="nav-avatar">
              {perfil
                .nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>

            <div className="nav-user-info">
              <strong>
                {perfil
                  .nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {
                  rolActual.nombre
                }
              </span>
            </div>
          </div>

          <button
            type="button"
            className="nav-signout"
            onClick={() => {
              setMenuAbierto(false)
              setCambiandoClave(true)
            }}
          >
            <span aria-hidden="true">
              ⚿
            </span>{' '}

            Cambiar contraseña
          </button>

          <button
            type="button"
            className="nav-signout"
            onClick={() => {
              setMenuAbierto(false)
              setCambiandoClave(false)
              void cerrarSesion()
            }}
          >
            <span aria-hidden="true">
              ↪
            </span>{' '}

            Cerrar sesión
          </button>
        </div>
      </aside>


      <section className="content">
        <header className="bar">
          <button
            className="menu-toggle"
            type="button"
            onClick={() =>
              setMenuAbierto(true)
            }
            aria-label="Abrir menú"
            aria-expanded={
              menuAbierto
            }
          >
            <span />
            <span />
            <span />
          </button>

          <div className="bar-path">
            <span>
              Casa Hogar
            </span>

            {grupoSeleccionado && (
              <>
                <span className="bar-sep">
                  /
                </span>

                <span>
                  {
                    grupoSeleccionado.nombre
                  }
                </span>
              </>
            )}

            <span className="bar-sep">
              /
            </span>

            <strong>
              {moduloSeleccionado
                ?.nombre ??
                'Inicio'}
            </strong>
          </div>

          <div className="bar-user">
            <div className="bar-dot" />

            <div className="bar-user-text">
              <strong>
                {perfil
                  .nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {
                  rolActual.nombre
                }
              </span>
            </div>

            <div className="bar-avatar">
              {perfil
                .nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>
          </div>
        </header>


        <main className="body">
          <div className="body-head">
            <div>
              <span className="body-eyebrow">
                CASA HOGAR /{' '}
                {rolActual.nombre.toUpperCase()}
              </span>

              <h1 className="body-title">
                {moduloSeleccionado
                  ?.id ===
                  'dashboard'
                  ? 'Panel principal'
                  : moduloSeleccionado
                      ?.nombre ??
                    'Inicio'}
              </h1>

              <p className="body-desc">
                {moduloSeleccionado
                  ?.id ===
                  'dashboard'
                  ? 'Bienvenido a tu espacio de trabajo.'
                  : esConsulta
                    ? `Consulta ${
                        moduloSeleccionado
                          ?.nombre
                          .toLowerCase() ??
                        'la información'
                      } desde aquí.`
                    : `Gestiona ${
                        moduloSeleccionado
                          ?.nombre
                          .toLowerCase() ??
                        'tu área'
                      } desde aquí.`}
              </p>
            </div>

            <div className="body-badge">
              <span className="badge-dot" />

              {esConsulta
                ? 'Acceso de consulta'
                : 'Acceso autorizado'}
            </div>
          </div>

          {cambiandoClave ? (
            <AccountPasswordModule
              onClose={() =>
                setCambiandoClave(false)
              }
            />
          ) : (
            renderModulo()
          )}
        </main>
      </section>

      {segundosInactividad !== null && (
        <div className="inactividad-fondo">
          <section
            className="inactividad-aviso"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="inactividad-titulo"
            aria-describedby="inactividad-texto"
          >
            <h2 id="inactividad-titulo">¿Sigues ahí?</h2>

            <p id="inactividad-texto">
              Por seguridad, tu sesión se cerrará en{' '}
              <strong>
                {Math.floor(segundosInactividad / 60)}:
                {String(segundosInactividad % 60).padStart(2, '0')}
              </strong>{' '}
              porque no hubo actividad en casi una hora.
            </p>

            <div className="inactividad-acciones">
              <button
                type="button"
                className="product-secondary-button"
                onClick={() => void cerrarSesion()}
              >
                Cerrar sesión
              </button>

              <button
                type="button"
                className="product-primary-button"
                onClick={seguirConectado}
                autoFocus
              >
                Seguir conectado
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}


// =====================================================
// ROUTER SIMPLE DE PORTALES
// =====================================================

function App() {
  const [path, setPath] =
    useState(window.location.pathname)

  function navigate(nextPath: string) {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }

    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname)
    }

    window.addEventListener('popstate', handlePopState)

    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/login')
      setPath('/login')
    }

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  if (path.startsWith('/tienda')) {
    return (
      <Storefront
        path={path}
        navigate={navigate}
      />
    )
  }

  return (
    <InternalSystemApp
      navigate={navigate}
    />
  )
}

export default App