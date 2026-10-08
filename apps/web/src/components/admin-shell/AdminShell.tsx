"use client";
import {
  faBars,
  faChevronLeft,
  faRightFromBracket,
  faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "../confirm-dialog/ConfirmDialog";
import { IconButton } from "../icon-button/IconButton";
import { Modal } from "../modal/Modal";
import { navigation } from "./navigation";
export function AdminShell({
  section,
  children,
  onLogout,
  capabilities,
}: {
  section: string;
  children: React.ReactNode;
  onLogout: () => void;
  capabilities: string[];
}) {
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [confirm, setConfirm] = useState(false);
  const menu = (
    <nav aria-label="Administração">
      {navigation
        .filter((item) => capabilities.includes(item.permission))
        .map((item) => (
          <Link
            key={item.id}
            href={item.id === "overview" ? "/overview" : `/${item.id}`}
            className={item.sections.includes(section) ? "active" : ""}
            aria-current={item.sections.includes(section) ? "page" : undefined}
            title={item.label}
            onClick={() => setMobile(false)}
          >
            <FontAwesomeIcon icon={item.icon} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        ))}
    </nav>
  );
  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <a href="#main" className="skip-link">
        Ir para o conteúdo
      </a>
      <header className="mobile-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Abrir menu da administração"
          aria-expanded={mobile}
          aria-controls="mobile-navigation"
          onClick={(event) => {
            event.currentTarget.focus();
            setMobile(true);
          }}
        >
          <FontAwesomeIcon icon={faBars} />
        </button>
        <Link href="/overview" className="brand">
          Jarvis
        </Link>
      </header>
      <aside className="sidebar">
        <Link href="/overview" className="brand">
          <FontAwesomeIcon icon={faRobot} />
          <span>
            Jarvis<span className="brand-subtitle">Central de operações</span>
          </span>
        </Link>
        {menu}
        <footer>
          <button
            type="button"
            className="nav-action"
            onClick={() => setConfirm(true)}
            title="Sair da conta"
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Sair da conta</span>
          </button>
          <IconButton
            label={collapsed ? "Expandir menu" : "Recolher menu"}
            icon={faChevronLeft}
            onClick={() => setCollapsed(!collapsed)}
          />
        </footer>
      </aside>
      {mobile && (
        <Modal title="Menu da administração" onClose={() => setMobile(false)}>
          <div id="mobile-navigation" className="mobile-drawer">
            {menu}
            <button
              type="button"
              onClick={() => {
                setMobile(false);
                setConfirm(true);
              }}
            >
              Sair da conta
            </button>
          </div>
        </Modal>
      )}
      <main id="main" className="main-content">
        <div className="operation-bar">
          <span>
            <strong>JARVIS</strong> / CENTRAL
          </span>
          <span>Casa · Assistentes · Dispositivos</span>
        </div>
        <div className="page-content">{children}</div>
      </main>
      {confirm && (
        <ConfirmDialog
          title="Sair da conta?"
          description="Você precisará entrar novamente para acessar o painel."
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            onLogout();
          }}
        />
      )}
    </div>
  );
}
