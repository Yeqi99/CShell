import {PingButton} from './PingButton';
import type { LocalConnectionTarget } from '../../shared/local-terminal';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Server,
  Globe,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { defaults, type Preferences, type GroupAction, type Profile } from '../../shared/contracts';
import { connectionUsesVisual } from '../../shared/connection-view';
import { useI18n } from '../i18n';
type Menu = { x: number; y: number } & (
  { kind: 'server'; profile: Profile; page: 'root' | 'groups' } | { kind: 'group'; name: string } | { kind: 'appearance' }
);
export function ServerSidebar({
  profiles,
  preferences = defaults,
  onPreferences,
  targets = [],
  onTarget,
  groups,
  activeProfile,
  online,
  onOpen,
  onConnect,
  onVisual,
  onSave,
  onMove,
  onDelete,
  onManageGroup,
}: {
  profiles: Profile[];
  preferences?: Preferences;
  onPreferences?: (preferences: Preferences) => Promise<void>;
  targets?: LocalConnectionTarget[];
  onTarget?: (target: LocalConnectionTarget) => void;
  groups: string[];
  activeProfile?: string;
  online: string[];
  onOpen: (p?: Profile) => void;
  onConnect: (p: Profile) => void;
  onVisual?: (p: Profile) => void;
  onSave: (p: Profile) => Promise<void>;
  onMove?: (id: string, group: string, before?: string) => Promise<void>;
  onDelete: (p: Profile) => void;
  onManageGroup: (action: GroupAction) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [appearanceExpanded, setAppearanceExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ original?: string; move?: Profile } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState('');
  const [drop, setDrop] = useState<{ group: string; before?: string } | null>(null);
  const pointerDrag = useRef<{id:string;x:number;y:number;active:boolean;drop?:{group:string;before?:string}} | undefined>(undefined);
  const suppressClickUntil = useRef(0);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const report = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    setError(
      t(
        message.includes('GROUP_EXISTS')
          ? 'groupExists'
          : message.includes('GROUP_MISSING')
            ? 'groupMissing'
            : message.includes('GROUP_LIMIT')
              ? 'groupLimit'
              : 'groupSaveFailed',
      ),
    );
  };
  const closeMenu = (restore = false) => {
    const focused = document.activeElement;
    const restoreFromMenu = restore && !!popup.current?.contains(focused);
    setMenu(null);
    if (restoreFromMenu)
      requestAnimationFrame(() => {
        // A completed save must not steal focus after the user resumed another task.
        if (document.activeElement === document.body || document.activeElement === focused)
          trigger.current?.focus();
      });
  };
  useLayoutEffect(()=>{if(!menu||!popup.current)return;const rect=popup.current.getBoundingClientRect();const y=Math.max(8,Math.min(menu.y,innerHeight-rect.height-8));if(y!==menu.y)setMenu({...menu,y});},[menu,appearanceExpanded]);
  useEffect(() => {
    if (!menu) return;
    const focus = requestAnimationFrame(() =>
      popup.current?.querySelector<HTMLButtonElement>('button')?.focus(),
    );
    const outside = (e: PointerEvent) => {
      if (
        !popup.current?.contains(e.target as Node) &&
        (menu.kind === 'appearance' || !trigger.current?.contains(e.target as Node))
      )
        closeMenu();
    };
    const scroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) closeMenu();
    };
    const resize = () => closeMenu();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [menu]);
  const openMenu = (
    target: HTMLElement,
    next:
      | Omit<Extract<Menu, { kind: 'server' }>, 'x' | 'y'>
      | Omit<Extract<Menu, { kind: 'group' }>, 'x' | 'y'>
      | Omit<Extract<Menu, { kind: 'appearance' }>, 'x' | 'y'>,
    point?: { x: number; y: number },
  ) => {
    if (menu && trigger.current === target && !point) {
      closeMenu();
      return;
    }
    trigger.current = target;
    if(next.kind==='appearance')setAppearanceExpanded(false);
    const rect = target.getBoundingClientRect();
    setMenu({
      ...next,
      x: Math.max(8, Math.min(point?.x ?? rect.left, innerWidth - 228)),
      y: Math.max(8, Math.min(point?.y ?? rect.bottom + 5, innerHeight - (next.kind === 'appearance' ? 44 : 320))),
    });
  };
  const beginGroup = (original?: string, move?: Profile) => {
    setMenu(null);
    setName(original || '');
    setError('');
    setEditor({ original, move });
  };
  async function saveGroup() {
    if (working) return;
    const next = name.trim();
    if (!next) {
      setError(t('groupNameRequired'));
      return;
    }
    setWorking(true);
    setError('');
    try {
      if (editor?.move) {
        if (groupNames.includes(next)) throw new Error('GROUP_EXISTS');
        // Saving the destination and the profile together avoids a half-completed move.
        await onSave({ ...editor.move, group: next });
      } else {
        await onManageGroup(
          editor?.original
            ? { type: 'rename', name: editor.original, next }
            : { type: 'create', name: next },
        );
      }
      setEditor(null);
      setCollapsed((items) => items.filter((item) => item !== `group:${next}`));
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
    }
  }
  async function move(profile: Profile, group: string) {
    try {
      await onSave({ ...profile, group });
      setCollapsed((items) => items.filter((item) => item !== `group:${group}`));
      closeMenu(true);
      setError('');
    } catch (e) {
      report(e);
      closeMenu();
    }
  }
  const filtered = profiles.filter((p) =>
    `${p.name} ${p.host} ${p.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groupNames = [
    ...new Set([...groups, ...profiles.map((p) => p.group).filter(Boolean)]),
  ].sort((a, b) => a.localeCompare(b, locale));
  const sections = [
    {
      id: '__favorites',
      name: t('favorites'),
      items: filtered.filter((p) => p.favorite),
      favorite: true,
    },
    ...['', ...groupNames].map((group) => ({
      id: group,
      name: group || t('ungrouped'),
      items: filtered.filter((p) => p.group === group),
      favorite: false,
    })),
  ].filter((section) => section.items.length || (!query && !section.favorite && section.id));
  return (
    <aside className="sidebar" aria-busy={working} tabIndex={0} onContextMenu={e => {
      if (!onPreferences || e.defaultPrevented || (e.target as HTMLElement).closest('button,input,a,[data-profile-id]')) return;
      e.preventDefault(); openMenu(e.currentTarget, {kind:'appearance'}, {x:e.clientX,y:e.clientY});
    }} onKeyDown={e => {if(onPreferences && e.target === e.currentTarget && (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10')) {e.preventDefault();openMenu(e.currentTarget,{kind:'appearance'});}}}>
      <div className="sidebar-search">
        <Search size={14} />
        <input
          aria-label={t('searchServers')}
          placeholder={t('searchServers')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button className="secondary new-connection" onClick={() => onOpen()}>
        <Plus size={16} />
        {t('newServer')}
      </button>
      <div className="server-groups-heading">
        <span>{t('groups')}</span>
        <button onClick={() => beginGroup()} title={t('newGroup')}>
          <FolderPlus size={13} />
          {t('newGroup')}
        </button>
      </div>
      {editor && (
        <form
          className="group-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void saveGroup();
          }}
        >
          <label htmlFor="sidebar-group-name">
            {t(editor.original ? 'renameGroup' : 'newGroup')}
          </label>
          <div>
            <input
              id="sidebar-group-name"
              autoFocus
              maxLength={100}
              value={name}
              disabled={working}
              placeholder={t('groupName')}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditor(null);
                  setError('');
                }
              }}
            />
            <button
              className="icon"
              disabled={working}
              aria-label={t('saveGroup')}
              title={t('saveGroup')}
            >
              <Check size={15} />
            </button>
            <button
              className="icon"
              type="button"
              disabled={working}
              aria-label={t('cancel')}
              title={t('cancel')}
              onClick={() => {
                setEditor(null);
                setError('');
              }}
            >
              <X size={14} />
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="sidebar-error" role="alert">
          {error}
        </p>
      )}
      <div className="server-list">
        {dragging && <div className="sidebar-drag-hint" role="status">{profiles.find(p => p.id === dragging)?.name} → {drop ? `${drop.group || t('ungrouped')}${drop.before ? ' · 插入此机器之前' : ' · 移到分组末尾'}` : '拖到机器之间或分组标题'}</div>}
        {!!targets.length && (
          <section className="server-group">
            <div className="group-heading">
              <span className="group-name">本机环境</span>
              <small>{targets.length}</small>
            </div>
            {targets
              .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
              .map((target) => (
                <button
                  className="local-target-row"
                  key={target.id}
                  onDoubleClick={() => onTarget?.(target)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onTarget?.(target);
                    }
                  }}
                  title="双击打开终端"
                >
                  <Server size={20} />
                  <span>
                    <strong>{target.name}</strong>
                    <small>{target.detail}</small>
                  </span>
                </button>
              ))}
          </section>
        )}
        {sections.map((section) => (
          <section
            key={`${section.favorite ? 'favorite' : 'group'}:${section.id}`}
            className={`server-group ${dragging && drop?.group === section.id && !drop.before ? 'group-drop-target' : ''}`}
            data-group={section.favorite ? undefined : section.id}
          >
            <div className="group-heading">
              <button
                className="group-title"
                aria-expanded={
                  !collapsed.includes(`${section.favorite ? 'favorite' : 'group'}:${section.id}`)
                }
                onClick={() =>
                  setCollapsed((current) =>
                    current.includes(`${section.favorite ? 'favorite' : 'group'}:${section.id}`)
                      ? current.filter(
                          (x) => x !== `${section.favorite ? 'favorite' : 'group'}:${section.id}`,
                        )
                      : [...current, `${section.favorite ? 'favorite' : 'group'}:${section.id}`],
                  )
                }
              >
                {collapsed.includes(`${section.favorite ? 'favorite' : 'group'}:${section.id}`) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {section.favorite && <Star size={11} />}
                <span className="group-name">{section.name}</span>
                <small>{section.items.length}</small>
              </button>
              {!section.favorite && section.id && (
                <button
                  className="icon group-more"
                  title={`${t('manageGroup')} · ${section.name}`}
                  aria-label={`${t('manageGroup')} · ${section.name}`}
                  onClick={(e) => openMenu(e.currentTarget, { kind: 'group', name: section.id })}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
            {!collapsed.includes(`${section.favorite ? 'favorite' : 'group'}:${section.id}`) &&
              section.items.map((profile) => (
                <div
                  key={profile.id}
                  className={`server-item ${activeProfile === profile.id ? 'active' : ''}`}
                  draggable={false}
                  data-profile={profile.id}
                  onClickCapture={e => {if(Date.now()<suppressClickUntil.current){e.preventDefault();e.stopPropagation();}}}
                  onDoubleClickCapture={e => {if(Date.now()<suppressClickUntil.current){e.preventDefault();e.stopPropagation();}}}
                  onPointerDown={e => {
                    if (!onMove || working || e.button !== 0 || (e.target as HTMLElement).closest('.favorite-button,.server-more,.ping-button')) return;
                    pointerDrag.current = { id:profile.id, x:e.clientX, y:e.clientY, active:false };
                    ((e.target as HTMLElement).closest<HTMLElement>('.server-open') ?? e.currentTarget).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={e => {
                    const drag = pointerDrag.current; if (!drag) return;
                    if (!drag.active && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6) return;
                    if (!drag.active) e.currentTarget.setPointerCapture(e.pointerId);
                    drag.active=true; setDragging(drag.id); closeMenu();
                    const hit=document.elementFromPoint(e.clientX,e.clientY), group=hit?.closest<HTMLElement>('[data-group]');
                    if (!group) { drag.drop=undefined; setDrop(null); return; }
                    const row=hit?.closest<HTMLElement>('[data-profile]');
                    drag.drop={group:group.dataset.group!,before:row?.dataset.profile}; setDrop(drag.drop);
                    const list=group.closest('.server-list'); if(list){const rect=list.getBoundingClientRect(); if(e.clientY<rect.top+30)list.scrollTop-=12;else if(e.clientY>rect.bottom-30)list.scrollTop+=12;}
                  }}
                  onPointerUp={e => {
                    const drag=pointerDrag.current; pointerDrag.current=undefined; setDragging('');setDrop(null);
                    if(drag?.active)suppressClickUntil.current=Date.now()+500;
                    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
                    if(!drag?.active||!drag.drop||drag.drop.before===drag.id||!onMove)return;
                    e.preventDefault();setWorking(true);void onMove(drag.id,drag.drop.group,drag.drop.before).catch(report).finally(()=>setWorking(false));
                  }}
                  onPointerCancel={() => {pointerDrag.current=undefined;setDragging('');setDrop(null);}}
                  onKeyDown={e => {if(e.key==='Escape'){pointerDrag.current=undefined;setDragging('');setDrop(null);}}}
                  data-dragging={dragging === profile.id || undefined}
                  data-drop-before={!!dragging && !section.favorite && drop?.before === profile.id || undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(
                      e.currentTarget.querySelector<HTMLButtonElement>('.server-more')!,
                      { kind: 'server', profile, page: 'root' },
                      { x: e.clientX, y: e.clientY },
                    );
                  }}
                >
                  <div className="server-row">
                    <button
                      className="server-open"
                      draggable={false}
                      onDoubleClick={() => onConnect(profile)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onConnect(profile);
                        }
                      }}
                      onClick={() => closeMenu()}
                      title={
                        profile.protocol === 'http'
                          ? 'HTTP 请求工作区'
                          : `${profile.protocol === 'client' ? 'Agent · ' : profile.username + '@'}${profile.host}:${profile.port}`
                      }
                    >
                      <div className="server-glyph">
                        {profile.protocol === 'http' ? <Globe size={16} /> : <Server size={16} />}
                      </div>
                      {profile.protocol !== 'http' && (
                        <i className={`dot ${online.includes(profile.id) ? '' : 'off'}`} />
                      )}
                      <div>
                        <strong>{profile.name}</strong>
                        <small>{profile.protocol === 'http' ? 'HTTP' : profile.host}</small>
                      </div>
                    </button>
                    {profile.protocol!=='http'&&<PingButton key={profile.host} profileId={profile.id}/>}
                    <button
                      className={`icon favorite-button ${profile.favorite ? 'starred' : ''}`}
                      aria-label={`${t(profile.favorite ? 'unfavorite' : 'favorite')} ${profile.name}`}
                      title={t(profile.favorite ? 'unfavorite' : 'favorite')}
                      onClick={() =>
                        void onSave({ ...profile, favorite: !profile.favorite }).catch(report)
                      }
                    >
                      <Star size={13} fill={profile.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className="icon server-more"
                      aria-label={`${t('serverActions')} · ${profile.name}`}
                      title={t('serverActions')}
                      aria-expanded={menu?.kind === 'server' && menu.profile.id === profile.id}
                      onClick={(e) =>
                        openMenu(e.currentTarget, { kind: 'server', profile, page: 'root' })
                      }
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>
              ))}
            {!section.items.length &&
              !collapsed.includes(`${section.favorite ? 'favorite' : 'group'}:${section.id}`) && (
                <p className="empty-group">{t('emptyGroup')}</p>
              )}
          </section>
        ))}
        {!profiles.length && !groups.length && (
          <div className="sidebar-empty-state">
            <Server size={24} strokeWidth={1.3} aria-hidden="true" />
            <p>{t('noSavedConnections')}</p>
            <small>{t('noServersHint')}</small>
          </div>
        )}
        {!!query && !filtered.length && <p className="sidebar-empty">{t('noSearchResults')}</p>}
      </div>
      <div className="sidebar-footnote">
        <Server size={12} />
        {profiles.length} {t('servers')}
      </div>
      {menu &&
        createPortal(
          <div
            ref={popup}
            className="server-context-menu"
            role="menu"
            aria-label={menu.kind === 'appearance' ? (locale === 'zh-CN' ? '侧边栏外观' : 'Sidebar appearance') : t(menu.kind === 'group' ? 'manageGroup' : 'serverActions')}
            style={{ left: menu.x, top: menu.y, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMenu(true);
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                ].filter(button=>button.offsetParent!==null);
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                items[
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? items.length - 1
                      : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                ]?.focus();
              }
              if (e.key === 'Tab') closeMenu();
            }}
          >
            {menu.kind === 'appearance' ? (<>
              <button role="menuitem" aria-expanded={appearanceExpanded} onClick={()=>setAppearanceExpanded(value=>!value)}>{appearanceExpanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>} {locale==='zh-CN'?'外观设置':'Appearance settings'}</button>
              <div hidden={!appearanceExpanded}>
              {([['sidebarGroupSize', '分组字号', 'Group size', 8,22], ['sidebarFontSize','服务器字号','Server size',8,22], ['sidebarDetailSize','地址字号','Address size',8,20]] as const).map(([key,zh,en,min,max]) => <div key={key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px'}}><span style={{flex:1,whiteSpace:'nowrap'}}>{locale === 'zh-CN' ? zh : en}</span><button style={{width:28,minWidth:28,flex:'0 0 28px',padding:4,justifyContent:'center'}} aria-label={locale==='zh-CN'?`${zh}减小`:`Decrease ${en.toLowerCase()}`} disabled={working || preferences[key] <= min} onClick={() => {setWorking(true); void onPreferences?.({...preferences,[key]:preferences[key]-1}).catch(report).finally(()=>setWorking(false));}}>−</button><output>{preferences[key]}</output><button style={{width:28,minWidth:28,flex:'0 0 28px',padding:4,justifyContent:'center'}} aria-label={locale==='zh-CN'?`${zh}增大`:`Increase ${en.toLowerCase()}`} disabled={working || preferences[key] >= max} onClick={() => {setWorking(true);void onPreferences?.({...preferences,[key]:preferences[key]+1}).catch(report).finally(()=>setWorking(false));}}>+</button></div>)}
              {(['compact','comfortable','spacious'] as const).map((density,i) => <button role="menuitemradio" aria-checked={preferences.sidebarDensity===density} key={density} disabled={working} onClick={()=>{setWorking(true);void onPreferences?.({...preferences,sidebarDensity:density}).catch(report).finally(()=>setWorking(false));}}>{locale === 'zh-CN' ? ['紧凑间距','舒适间距','宽松间距'][i] : density}{preferences.sidebarDensity===density && <Check size={14}/>}</button>)}
              <button role="menuitem" disabled={working} onClick={()=>{setWorking(true);void onPreferences?.({...preferences,sidebarFontSize:defaults.sidebarFontSize,sidebarGroupSize:defaults.sidebarGroupSize,sidebarDetailSize:defaults.sidebarDetailSize,sidebarDensity:defaults.sidebarDensity}).catch(report).finally(()=>setWorking(false));}}>{locale === 'zh-CN' ? '恢复默认外观' : 'Reset sidebar appearance'}</button>
              </div>
            </>) : menu.kind === 'group' ? (
              <>
                <div className="context-caption">{menu.name}</div>
                <button role="menuitem" onClick={() => beginGroup(menu.name)}>
                  <Pencil size={14} />
                  {t('renameGroup')}
                </button>
                <div className="context-divider" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    void onManageGroup({ type: 'delete', name: menu.name }).catch(report);
                    closeMenu();
                  }}
                >
                  <Trash2 size={14} />
                  {t('deleteGroup')}
                </button>
                <small className="context-help">{t('deleteGroupHint')}</small>
              </>
            ) : menu.page === 'groups' ? (
              <>
                <button role="menuitem" onClick={() => setMenu({ ...menu, page: 'root' })}>
                  <ArrowLeft size={14} />
                  {t('moveToGroup')}
                </button>
                <div className="context-divider" />
                <div className="group-destinations">
                  {['', ...groupNames].map((group) => (
                    <button
                      key={group}
                      role="menuitemradio"
                      aria-checked={menu.profile.group === group}
                      onClick={() => void move(menu.profile, group)}
                    >
                      <span>{group || t('ungrouped')}</span>
                      {menu.profile.group === group && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <div className="context-divider" />
                <button role="menuitem" onClick={() => beginGroup(undefined, menu.profile)}>
                  <FolderPlus size={14} />
                  {t('newGroup')}
                </button>
              </>
            ) : (
              <>
                <div className="context-caption">{menu.profile.name}</div>
                {onVisual && !['http','ftp','ftps','sftp'].includes(menu.profile.protocol??'ssh') && <button role="menuitem" onClick={() => {onVisual(menu.profile);closeMenu();}}><Server size={14}/>{locale === 'zh-CN' ? '打开可视化桌面' : 'Open visual desktop'}</button>}
                {['ssh','rdp'].includes(menu.profile.protocol??'ssh')&&<button role="menuitemcheckbox" aria-checked={connectionUsesVisual(menu.profile,preferences)} disabled={working} onClick={()=>{setWorking(true);const current=profiles.find(item=>item.id===menu.profile.id)??menu.profile;void onSave({...current,defaultConnectionView:connectionUsesVisual(current,preferences)?'original':'visual'}).then(()=>closeMenu()).catch(report).finally(()=>setWorking(false));}}><span style={{width:14,display:'flex'}}>{connectionUsesVisual(menu.profile,preferences)&&<Check size={14}/>}</span>{locale==='zh-CN'?'默认以可视化打开':'Open in visual mode by default'}</button>}
                <button
                  role="menuitem"
                  onClick={() => {
                    onOpen(menu.profile);
                    closeMenu();
                  }}
                >
                  <Pencil size={14} />
                  {t('editConnection')}
                </button>
                <button role="menuitem" onClick={() => setMenu({ ...menu, page: 'groups' })}>
                  <FolderInput size={14} />
                  {t('moveToGroup')}
                  <ChevronRight size={12} className="context-tail" />
                </button>
                <div className="context-divider" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    onDelete(menu.profile);
                    closeMenu();
                  }}
                >
                  <Trash2 size={14} />
                  {t('deleteConnection')}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </aside>
  );
}

