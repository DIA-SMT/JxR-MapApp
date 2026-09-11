"use client";

import { MessageCircle, Phone, Search, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CHIP_FISCAL,
  contacto,
  enlaceWhatsApp as armarWhatsApp,
  ESTADOS_FISCAL,
  guardarFiscal,
  obtenerFiscales,
  obtenerMesas,
  quitarFiscal,
  type ConfigDiaD,
  type EstadoFiscal,
  type FiscalMesa,
  type Mesa,
} from "@/lib/diad";
import type { Persona } from "@/lib/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

const numero = (n: number) => n.toLocaleString("es-AR");
const sinAcentos = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Filtro = "todas" | "sin-fiscal" | "cubiertas" | "ausentes";

/**
 * Fiscales por mesa: quién está en cada una, en qué estado, y contacto en un
 * clic. Se agrupa por escuela porque así se trabaja el día de la elección —
 * un referente cubre una escuela entera, no mesas sueltas.
 */
export function Fiscales({
  supabase,
  config,
  personas,
  onCambio,
}: {
  supabase: SupabaseClient;
  config: ConfigDiaD;
  personas: Persona[];
  onCambio?: () => void;
}) {
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [fiscales, setFiscales] = useState<Map<number, FiscalMesa>>(new Map());
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = async () => {
    const fs = await obtenerFiscales(supabase);
    setFiscales(new Map(fs.map((f) => [f.mesa, f])));
    onCambio?.();
  };

  useEffect(() => {
    void (async () => {
      try {
        const [ms, fs] = await Promise.all([obtenerMesas(supabase), obtenerFiscales(supabase)]);
        setMesas(ms);
        setFiscales(new Map(fs.map((f) => [f.mesa, f])));
      } catch (e) {
        setError(e instanceof Error ? e.message : "no pude cargar las mesas");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  /** Mesas agrupadas por escuela, aplicando búsqueda y filtro. */
  const porEscuela = useMemo(() => {
    if (!mesas) return [];
    const texto = sinAcentos(q.trim());
    const grupos = new Map<string, Mesa[]>();
    for (const m of mesas) {
      const f = fiscales.get(m.mesa);
      if (filtro === "sin-fiscal" && f) continue;
      if (filtro === "cubiertas" && !f) continue;
      if (filtro === "ausentes" && f?.estado !== "ausente") continue;
      if (texto) {
        const enMesa =
          String(m.mesa).includes(texto) ||
          sinAcentos(m.escuela ?? "").includes(texto) ||
          sinAcentos(m.circuito ?? "").includes(texto) ||
          sinAcentos(f?.nombre ?? "").includes(texto) ||
          (f?.telefono ?? "").includes(texto);
        if (!enMesa) continue;
      }
      const clave = m.escuela ?? "sin escuela";
      const arr = grupos.get(clave) ?? [];
      arr.push(m);
      grupos.set(clave, arr);
    }
    return [...grupos.entries()]
      .map(([escuela, ms]) => {
        const cubiertas = ms.filter((m) => fiscales.has(m.mesa)).length;
        return {
          escuela,
          circuito: ms[0]?.circuito ?? "",
          mesas: ms,
          cubiertas,
          electores: ms.reduce((a, m) => a + m.electores, 0),
        };
      })
      // primero donde falta gente: es lo que hay que resolver
      .sort((a, b) => b.mesas.length - b.cubiertas - (a.mesas.length - a.cubiertas) || a.escuela.localeCompare(b.escuela));
  }, [mesas, fiscales, q, filtro]);

  const kpis = useMemo(() => {
    const total = mesas?.length ?? 0;
    const fs = [...fiscales.values()];
    return {
      total,
      cubiertas: fs.length,
      confirmados: fs.filter((f) => f.estado === "confirmado").length,
      presentes: fs.filter((f) => f.estado === "presente").length,
      ausentes: fs.filter((f) => f.estado === "ausente").length,
      sin: Math.max(0, total - fs.length),
    };
  }, [mesas, fiscales]);

  const cambiarEstado = async (m: Mesa, estado: EstadoFiscal) => {
    const f = fiscales.get(m.mesa);
    if (!f || ocupado) return;
    setOcupado(true);
    const e = await guardarFiscal(supabase, { ...f, estado });
    if (e) setError(e);
    else await recargar();
    setOcupado(false);
  };

  const borrar = async (mesa: number) => {
    if (ocupado) return;
    setOcupado(true);
    const e = await quitarFiscal(supabase, mesa);
    if (e) setError(e);
    else await recargar();
    setOcupado(false);
  };

  if (error) return <p className="p-4 text-xs text-peligro">{error}</p>;
  if (!mesas) return <p className="p-4 text-xs text-texto-2">Cargando las mesas del padrón…</p>;

  return (
    <div className="space-y-3">
      {/* KPIs de cobertura */}
      <div className="panel-vidrio flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3 text-xs">
        <span>
          <b className="num text-texto">{numero(kpis.cubiertas)}</b>
          <span className="text-texto-3">/{numero(kpis.total)} mesas con fiscal</span>
        </span>
        <span className={kpis.sin > 0 ? "font-bold text-sin" : "text-completo"}>
          <b className="num">{numero(kpis.sin)}</b> sin cubrir
        </span>
        <span className="h-4 w-px bg-borde-2" />
        <span className="text-texto-2">
          confirmados <b className="num text-celeste">{kpis.confirmados}</b> · presentes{" "}
          <b className="num text-completo">{kpis.presentes}</b> · ausentes{" "}
          <b className="num text-sin">{kpis.ausentes}</b>
        </span>
        {config.telefono_comando && (
          <a
            href={contacto(config.telefono_comando).tel ?? "#"}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-rosa/40 px-2.5 py-1 font-bold text-rosa transition hover:border-rosa"
            title="Llamar al comando central"
          >
            <Phone size={12} /> Comando
          </a>
        )}
      </div>

      {/* Búsqueda y filtros */}
      <div className="panel-vidrio flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div className="flex min-w-48 flex-1 items-center gap-1.5 rounded-xl border border-borde-2 bg-panel px-2.5 py-2">
          <Search size={13} className="shrink-0 text-texto-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Mesa, escuela, circuito, nombre o teléfono del fiscal…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-texto-3"
          />
          {q && (
            <button onClick={() => setQ("")} className="shrink-0 text-texto-3 hover:text-texto">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex overflow-hidden rounded-xl border border-borde-2 text-[11px] font-bold">
          {(
            [
              ["todas", "Todas"],
              ["sin-fiscal", "Sin fiscal"],
              ["cubiertas", "Cubiertas"],
              ["ausentes", "Ausentes"],
            ] as Array<[Filtro, string]>
          ).map(([clave, etiqueta]) => (
            <button
              key={clave}
              onClick={() => setFiltro(clave)}
              className={`px-2.5 py-2 transition ${filtro === clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {porEscuela.length === 0 && (
        <p className="px-1 text-xs text-texto-2">Ninguna mesa coincide con la búsqueda o el filtro.</p>
      )}

      {/* Escuelas: se abren para ver y asignar mesa por mesa */}
      {porEscuela.map((g) => {
        const faltan = g.mesas.length - g.cubiertas;
        const esta = abierta === g.escuela;
        return (
          <div key={g.escuela} className="panel-vidrio rounded-2xl">
            <button
              onClick={() => setAbierta(esta ? null : g.escuela)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold">{g.escuela}</div>
                <div className="text-[10px] text-texto-3">
                  Circuito {g.circuito} · {g.mesas.length} mesas · {numero(g.electores)} electores
                </div>
              </div>
              <span
                className={`num shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  faltan === 0 ? "border-completo/50 bg-completo/10 text-completo" : "border-sin/50 bg-sin/10 text-sin"
                }`}
              >
                {faltan === 0 ? "completa" : `faltan ${faltan}`}
              </span>
              <span className="shrink-0 text-texto-3">{esta ? "▴" : "▾"}</span>
            </button>

            {esta && (
              <div className="border-t border-borde px-2 py-2">
                {g.mesas.map((m) => {
                  const f = fiscales.get(m.mesa);
                  const c = f ? contacto(f.telefono) : null;
                  return (
                    <div key={m.mesa} className="border-b border-borde/60 py-2 last:border-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num shrink-0 rounded-lg bg-panel-3 px-2 py-1 text-[11px] font-bold">
                          Mesa {m.mesa}
                        </span>
                        <span className="shrink-0 text-[10px] text-texto-3">{numero(m.electores)} electores</span>

                        {f ? (
                          <>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={f.nombre}>
                              {f.nombre || "(sin nombre)"}
                              {f.rol !== "fiscal de mesa" && (
                                <span className="font-normal text-texto-3"> · {f.rol}</span>
                              )}
                            </span>
                            {/* Contacto en un clic: es para lo que existe esta pantalla */}
                            {c?.tel && (
                              <a
                                href={c.tel}
                                title={`Llamar a ${f.nombre} · ${c.crudo}`}
                                className="shrink-0 rounded-lg border border-borde-2 p-1.5 text-texto-2 transition hover:border-completo/60 hover:text-completo"
                              >
                                <Phone size={12} />
                              </a>
                            )}
                            {c?.whatsapp && (
                              <a
                                href={armarWhatsApp(c.whatsapp, m.mesa, g.escuela, config.eleccion)}
                                target="_blank"
                                rel="noreferrer"
                                title={`WhatsApp a ${f.nombre} · ${c.crudo}`}
                                className="shrink-0 rounded-lg border border-borde-2 p-1.5 text-texto-2 transition hover:border-completo/60 hover:text-completo"
                              >
                                <MessageCircle size={12} />
                              </a>
                            )}
                            {/* El estado se cambia con un clic: es lo que más se toca en la jornada */}
                            <div className="flex shrink-0 gap-1">
                              {ESTADOS_FISCAL.map((e) => (
                                <button
                                  key={e}
                                  onClick={() => void cambiarEstado(m, e)}
                                  title={CHIP_FISCAL[e].ayuda}
                                  className={`rounded-full border px-2 py-0.5 text-[9px] font-bold transition ${
                                    f.estado === e ? CHIP_FISCAL[e].clase : "border-borde text-texto-3 hover:text-texto"
                                  }`}
                                >
                                  {CHIP_FISCAL[e].texto}
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => setEditando(editando === m.mesa ? null : m.mesa)}
                              className="shrink-0 text-[10px] font-semibold text-rosa hover:underline"
                            >
                              editar
                            </button>
                            <button
                              onClick={() => void borrar(m.mesa)}
                              title="Quitar el fiscal de esta mesa"
                              className="shrink-0 text-texto-3 transition hover:text-peligro"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-xs font-semibold text-sin">Sin fiscal</span>
                            <button
                              onClick={() => setEditando(editando === m.mesa ? null : m.mesa)}
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-rosa px-2.5 py-1 text-[10px] font-bold text-white transition hover:brightness-110"
                            >
                              <UserPlus size={11} /> Asignar
                            </button>
                          </>
                        )}
                      </div>

                      {f?.notas && <p className="mt-1 pl-1 text-[10px] text-texto-3">{f.notas}</p>}

                      {editando === m.mesa && (
                        <FormularioFiscal
                          supabase={supabase}
                          mesa={m}
                          escuela={g.escuela}
                          circuito={g.circuito}
                          actual={f ?? null}
                          personas={personas}
                          onListo={async () => {
                            setEditando(null);
                            await recargar();
                          }}
                          onCancelar={() => setEditando(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Alta o edición del fiscal de una mesa. */
function FormularioFiscal({
  supabase,
  mesa,
  escuela,
  circuito,
  actual,
  personas,
  onListo,
  onCancelar,
}: {
  supabase: SupabaseClient;
  mesa: Mesa;
  escuela: string;
  circuito: string;
  actual: FiscalMesa | null;
  personas: Persona[];
  onListo: () => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [personaId, setPersonaId] = useState<string>(actual?.persona_id ? String(actual.persona_id) : "");
  const [nombre, setNombre] = useState(actual?.nombre ?? "");
  const [telefono, setTelefono] = useState(actual?.telefono ?? "");
  const [rol, setRol] = useState(actual?.rol ?? "fiscal de mesa");
  const [notas, setNotas] = useState(actual?.notas ?? "");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Al elegir una persona del operativo se traen su nombre y teléfono. */
  const elegirPersona = (id: string) => {
    setPersonaId(id);
    const p = personas.find((x) => String(x.id) === id);
    if (p) {
      setNombre(p.nombre);
      if (p.telefono) setTelefono(p.telefono);
    }
  };

  const guardar = async () => {
    if (guardando) return;
    if (!nombre.trim()) {
      setErr("Poné al menos el nombre");
      return;
    }
    setGuardando(true);
    setErr(null);
    const e = await guardarFiscal(supabase, {
      mesa: mesa.mesa,
      escuela,
      circuito,
      persona_id: personaId ? Number(personaId) : null,
      nombre,
      telefono,
      rol,
      estado: actual?.estado ?? "asignado",
      notas,
    });
    if (e) setErr(e);
    else await onListo();
    setGuardando(false);
  };

  const c = contacto(telefono);

  return (
    <div className="mt-2 rounded-xl border border-rosa/30 bg-rosa/5 p-2.5">
      <div className="flex flex-wrap gap-1.5">
        {personas.length > 0 && (
          <select
            value={personaId}
            onChange={(e) => elegirPersona(e.target.value)}
            title="Traer los datos de una persona ya cargada en el operativo"
            className="min-w-40 flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none"
          >
            <option value="">— del operativo (opcional) —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.telefono ? ` · ${p.telefono}` : ""}
              </option>
            ))}
          </select>
        )}
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre y apellido"
          className="min-w-36 flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="Teléfono"
          inputMode="tel"
          className="w-32 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <input
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          placeholder="Rol"
          title="fiscal de mesa, fiscal general, referente de escuela…"
          className="w-32 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
      </div>
      <input
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder="Notas (llega 7:30, tiene el acta, cubre también la mesa de al lado…)"
        className="mt-1.5 w-full rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void guardar()}
          disabled={guardando}
          className="rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button onClick={onCancelar} className="text-[11px] font-semibold text-texto-3 hover:text-texto">
          cancelar
        </button>
        {telefono.trim() !== "" && !c.whatsapp && (
          <span className="text-[10px] text-encurso">
            El teléfono no queda en 10 dígitos: se puede llamar, pero no se ofrece WhatsApp.
          </span>
        )}
        {err && <span className="text-[10px] text-peligro">{err}</span>}
      </div>
    </div>
  );
}
