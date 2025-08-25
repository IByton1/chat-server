import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

function App() {
    const [devices, setDevices] = useState([]);
    const [licenses, setLicenses] = useState([]);
    const host = location.origin;

    const loadDevices = async () => {
        const res = await fetch(`${host}/admin/devices`);
        setDevices(await res.json());
    };

    const loadLicenses = async () => {
        const res = await fetch(`${host}/admin/licenses`);
        setLicenses(await res.json());
    };

    const actDevice = async (id, cmd) => {
        await fetch(`${host}/admin/${cmd}/${id}`, { method: "POST" });
        loadDevices();
    };

    const createLicense = async () => {
        const res = await fetch(`${host}/admin/licenses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        const lic = await res.json();
        alert(`Neue Lizenz:\nID: ${lic.id}\ngültig bis: ${new Date(lic.validUntil).toLocaleDateString()}`);
        loadLicenses();
    };

    useEffect(() => {
        loadDevices();
        loadLicenses();
    }, []);

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-12">
            {/* Lizenzverwaltung */}
            <section>
                <h1 className="text-3xl font-semibold mb-4">Lizenzen verwalten</h1>
                <button
                    className="mb-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                    onClick={createLicense}
                >
                    Neue Lizenz erstellen
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {licenses.map((lic) => (
                        <div key={lic.id} className="border rounded p-4 shadow-sm bg-white">
                            <div className="font-mono text-sm break-all">{lic.id}</div>
                            <div className="text-gray-600 text-sm">
                                Gültig bis:{" "}
                                <strong>{new Date(lic.validUntil).toLocaleDateString()}</strong>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Geräteübersicht */}
            <section>
                <h1 className="text-3xl font-semibold mb-6">Geräte-Übersicht</h1>

                <div className="space-y-4">
                    {devices.map((d) => (
                        <div
                            key={d.id}
                            className="border rounded p-4 shadow-sm bg-white flex flex-col md:flex-row justify-between items-start md:items-center"
                        >
                            <div className="space-y-1 text-sm md:text-base">
                                <div className="font-mono break-all">ID: {d.id}</div>
                                <div>Lizenz: {d.licenseId || "–"}</div>
                                <div>
                                    Status:{" "}
                                    <span
                                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${d.blocked
                                                ? "bg-red-100 text-red-700"
                                                : "bg-green-100 text-green-700"
                                            }`}
                                    >
                                        {d.blocked ? "BLOCKED" : "OK"}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-3 md:mt-0">
                                <button
                                    className={`text-sm font-medium ${d.blocked
                                            ? "text-green-600 hover:underline"
                                            : "text-red-600 hover:underline"
                                        }`}
                                    onClick={() => actDevice(d.id, d.blocked ? "unblock" : "block")}
                                >
                                    {d.blocked ? "Freigeben" : "Sperren"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

createRoot(document.getElementById("root")).render(<App />);
