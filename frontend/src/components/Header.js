// frontend/src/components/Header.js
import React, { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import { MdAccountCircle } from "react-icons/md";
import "../components/Components.css";
import { useAuth } from "../auth/useAuth"; // ✅ import context

function Header() {
  const [showLogout, setShowLogout] = useState(false);
  const headerRef = useRef(null);
  const { logout, user } = useAuth(); // ✅ get logout + user info

  const toggle = () => setShowLogout((s) => !s);
  const close = () => setShowLogout(false);

  useEffect(() => {
    const onDocClick = (e) => {
      // close popup if clicking outside header area
      if (headerRef.current && !headerRef.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleLogout = async () => {
    try {
      await logout(); // ✅ triggers POST /logout and clears auth context
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      window.location.href = "/login"; // ✅ ensure redirect
    }
  };

  return (
    <div id="header" ref={headerRef}>
      <div className="brand">
        <img src={logo} alt="USTP Logo" className="logo" />
        <h1>University of Science and Technology of Southern Philippines</h1>
      </div>

      {/* Account icon */}
      <div className="account-area">
        <MdAccountCircle
          id="accountLogo"
          className="account-icon"
          title={user ? `Logged in as ${user.role}` : "Account"}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={showLogout}
        />

        {showLogout && (
          <div className="logout-popup" role="menu">
            <button onClick={handleLogout} role="menuitem">
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Header;
