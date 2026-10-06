import { useState } from "react";
import { formatMoney, todayAccra } from "../lib/format.js";
import { deleteScreenshots } from "../lib/storage.js";
import { errorMessage, supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Button, Field, Loading, Notice, Sheet } from "../ui.jsx";

function useSubmit(action, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await action();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return { busy, error, handleSubmit };
}

function Footer({ busy, error, label }) {
  return (
    <>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </>
  );
}

const moneyInput = { type: "number", inputMode: "decimal", step: "0.01", className: "input" };

export function DriverFormSheet({ driver, onClose, onSaved }) {
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const { busy, error, handleSubmit } = useSubmit(async () => {
    const values = { name: name.trim(), phone: phone.trim() || null };
    const query = driver
      ? supabase.from("drivers").update(values).eq("id", driver.id).select().single()
      : supabase.from("drivers").insert(values).select().single();
    const saved = await must(query);
    onSaved?.(saved);
  }, onClose);

  return (
    <Sheet title={driver ? "Edit driver" : "Add driver"} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Full name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" hint="Used to send the driver their link on WhatsApp.">
          <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label={driver ? "Save" : "Add driver"} />
      </form>
    </Sheet>
  );
}

export function VehicleFormSheet({ vehicle, onClose, onSaved }) {
  const [form, setForm] = useState({
    make_model: vehicle?.make_model ?? "",
    plate: vehicle?.plate ?? "",
    purchase_price: vehicle ? String(vehicle.purchase_price) : "",
    purchase_date: vehicle?.purchase_date ?? "",
    notes: vehicle?.notes ?? "",
  });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const { busy, error, handleSubmit } = useSubmit(async () => {
    const values = {
      make_model: form.make_model.trim(),
      plate: form.plate.trim().toUpperCase() || null,
      purchase_price: Number(form.purchase_price || 0),
      purchase_date: form.purchase_date || null,
      notes: form.notes.trim() || null,
    };
    const query = vehicle
      ? supabase.from("vehicles").update(values).eq("id", vehicle.id)
      : supabase.from("vehicles").insert(values);
    await must(query);
    onSaved?.();
  }, onClose);

  return (
    <Sheet title={vehicle ? "Edit car" : "Add car"} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Make and model">
          <input className="input" required placeholder="e.g. Toyota Vitz 2012" value={form.make_model} onChange={set("make_model")} />
        </Field>
        <Field label="Plate number">
          <input className="input" autoCapitalize="characters" value={form.plate} onChange={set("plate")} />
        </Field>
        <div className="form-grid">
          <Field label="What you paid (GH₵)">
            <input {...moneyInput} min="0" required value={form.purchase_price} onChange={set("purchase_price")} />
          </Field>
          <Field label="Date bought">
            <input className="input" type="date" max={todayAccra()} value={form.purchase_date} onChange={set("purchase_date")} />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea className="input" value={form.notes} onChange={set("notes")} />
        </Field>
        <Footer busy={busy} error={error} label={vehicle ? "Save" : "Add car"} />
        {vehicle && <DeleteVehicleButton vehicle={vehicle} onDeleted={onSaved} onClose={onClose} />}
      </form>
    </Sheet>
  );
}

export function StartAgreementSheet({ driver, onClose, onSaved }) {
  const { data: vehicles, error: loadError } = useLoad(async () => {
    const rows = await must(supabase.from("vehicles").select("id, make_model, plate, agreements(status)").order("make_model"));
    return rows.filter((v) => !v.agreements.some((a) => a.status === "active" || a.status === "completed"));
  }, []);
  const [vehicleId, setVehicleId] = useState("");
  const [carPrice, setCarPrice] = useState("");
  const [startDate, setStartDate] = useState(todayAccra());
  const [deposit, setDeposit] = useState("");
  const [depositPaidOn, setDepositPaidOn] = useState(todayAccra());
  const [depositReference, setDepositReference] = useState("");

  const price = Number(carPrice || 0);
  const depositValue = Number(deposit || 0);

  const { busy, error, handleSubmit } = useSubmit(async () => {
    if (depositValue >= price) throw new Error("The deposit must be less than the price to own.");
    await must(
      supabase.rpc("admin_start_agreement", {
        p_driver_id: driver.id,
        p_vehicle_id: vehicleId,
        p_car_price: price,
        p_start_date: startDate,
        p_deposit: depositValue,
        p_deposit_paid_on: depositValue > 0 ? depositPaidOn : null,
        p_deposit_reference: depositValue > 0 ? depositReference.trim() || null : null,
      })
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title={`Give ${driver.name} a car`} onClose={onClose}>
      {loadError && <Notice tone="red">{loadError}</Notice>}
      {!vehicles && !loadError && <Loading />}
      {vehicles && vehicles.length === 0 && (
        <Notice tone="amber">No cars are free. Add a car in the Cars tab first.</Notice>
      )}
      {vehicles && vehicles.length > 0 && (
        <form className="form" onSubmit={handleSubmit}>
          <Field label="Car">
            <select className="input" required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Choose a car…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make_model}
                  {v.plate ? ` · ${v.plate}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Price to own (GH₵)" hint="Total the driver pays before the car is theirs.">
              <input {...moneyInput} min="1" required value={carPrice} onChange={(e) => setCarPrice(e.target.value)} />
            </Field>
            <Field label="Start date">
              <input className="input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Deposit received (GH₵)" hint="Paid in full before handover. Counts toward the price and can't be changed later.">
            <input {...moneyInput} min="0" placeholder="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
          {depositValue > 0 && (
            <div className="form-grid">
              <Field label="Date deposit paid">
                <input className="input" type="date" required max={todayAccra()} value={depositPaidOn} onChange={(e) => setDepositPaidOn(e.target.value)} />
              </Field>
              <Field label="Transaction ID (optional)">
                <input className="input" autoComplete="off" value={depositReference} onChange={(e) => setDepositReference(e.target.value)} />
              </Field>
            </div>
          )}
          {price > 0 && (
            <Notice tone="muted">
              {depositValue > 0
                ? `After the ${formatMoney(depositValue)} deposit, the driver pays ${formatMoney(Math.max(0, price - depositValue))} in weekly installments.`
                : `The driver pays ${formatMoney(price)} in weekly installments.`}
            </Notice>
          )}
          <Footer busy={busy} error={error} label="Start agreement" />
        </form>
      )}
    </Sheet>
  );
}

export function ExtraSheet({ agreementId, onClose, onSaved }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayAccra());
  const [ownerCost, setOwnerCost] = useState("");

  const { busy, error, handleSubmit } = useSubmit(async () => {
    const value = Number(amount);
    if (!value) throw new Error("Enter an amount.");
    await must(
      supabase.from("extras").insert({
        agreement_id: agreementId,
        description: description.trim(),
        amount: value,
        date,
        owner_cost: Number(ownerCost || 0),
      })
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title="Add to total" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="muted">
          Adds to what the driver must pay to own the car. Extras can't be deleted later; to undo one, add it again
          with a minus amount.
        </Notice>
        <Field label="What for">
          <input className="input" required placeholder="e.g. Front bumper repair" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Amount (GH₵)">
            <input {...moneyInput} required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="What you actually spent (GH₵, optional)" hint="Counts as a cost on this car in Finance.">
          <input {...moneyInput} min="0" value={ownerCost} onChange={(e) => setOwnerCost(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Add" />
      </form>
    </Sheet>
  );
}

export function AdjustmentSheet({ agreementId, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayAccra());
  const [reason, setReason] = useState("");

  const { busy, error, handleSubmit } = useSubmit(async () => {
    const value = Number(amount);
    if (!value) throw new Error("Enter an amount.");
    await must(supabase.from("adjustments").insert({ agreement_id: agreementId, amount: value, date, reason: reason.trim() }));
    onSaved?.();
  }, onClose);

  return (
    <Sheet title="Correct amount paid" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="muted">
          Use a positive amount to add to what the driver has paid (e.g. cash handed over), or a minus amount to take
          away (e.g. a payment approved by mistake). The driver sees the reason.
        </Notice>
        <div className="form-grid">
          <Field label="Amount (GH₵)">
            <input {...moneyInput} required placeholder="e.g. 500 or -500" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Save correction" />
      </form>
    </Sheet>
  );
}

export function RejectSheet({ payment, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const { busy, error, handleSubmit } = useSubmit(async () => {
    await must(
      supabase
        .from("payments")
        .update({ status: "rejected", review_note: reason.trim() })
        .eq("id", payment.id)
        .eq("status", "pending")
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title={`Reject ${formatMoney(payment.amount)}`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Reason (the driver sees this)">
          <input className="input" required placeholder="e.g. Not on my MoMo statement" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Reject payment" />
      </form>
    </Sheet>
  );
}

export function TerminateSheet({ agreement, onClose, onSaved }) {
  const [endedOn, setEndedOn] = useState(todayAccra());
  const [note, setNote] = useState("");
  const { busy, error, handleSubmit } = useSubmit(async () => {
    await must(
      supabase
        .from("agreements")
        .update({ status: "terminated", ended_on: endedOn, end_note: note.trim() || null })
        .eq("id", agreement.agreement_id)
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title="End agreement and take car back" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="red">
          This can't be undone. The driver will no longer be able to log payments, and the car becomes free to give to
          someone else. All history is kept.
        </Notice>
        <Field label="Date ended">
          <input className="input" type="date" required min={agreement.start_date} value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="input" required value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="End agreement" />
      </form>
    </Sheet>
  );
}

// Correcting a mistyped price. The deposit and all payments stay as they are.
export function AgreementPriceSheet({ agreement, onClose, onSaved }) {
  const [carPrice, setCarPrice] = useState(String(agreement.car_price));
  const price = Number(carPrice || 0);

  const { busy, error, handleSubmit } = useSubmit(async () => {
    if (!(price > 0)) throw new Error("Enter the price to own.");
    if (price <= Number(agreement.deposit)) {
      throw new Error(`The price must be more than the ${formatMoney(agreement.deposit)} deposit.`);
    }
    await must(supabase.from("agreements").update({ car_price: price }).eq("id", agreement.agreement_id));
    onSaved?.();
  }, onClose);

  const extras = Number(agreement.extras_total || 0);

  return (
    <Sheet title="Change price to own" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="muted">
          Use this to fix a mistyped price, or if you agreed a new price with the driver. Payments, the deposit and
          extras are not affected.
        </Notice>
        <Field label="Price to own (GH₵)" hint="What the driver pays in total to own the car, before extras.">
          <input {...moneyInput} min="1" required value={carPrice} onChange={(e) => setCarPrice(e.target.value)} />
        </Field>
        {price > 0 && (
          <Notice tone="muted">
            Total to own becomes {formatMoney(price + extras)}
            {extras ? ` (price plus ${formatMoney(extras)} of extras)` : ""}, and the driver has paid{" "}
            {formatMoney(agreement.paid)} so far.
          </Notice>
        )}
        <Footer busy={busy} error={error} label="Save price" />
      </form>
    </Sheet>
  );
}

// Removes a driver and everything about them. For mistakes and test data.
export function DeleteDriverSheet({ driver, onClose, onDeleted }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === driver.name.trim().toLowerCase();

  const { busy, error, handleSubmit } = useSubmit(async () => {
    if (!matches) throw new Error("Type the driver's name exactly to confirm.");
    const result = await must(supabase.rpc("admin_delete_driver", { p_driver_id: driver.id }));
    await deleteScreenshots(result?.screenshots ?? []);
    onDeleted?.(result);
  }, onClose);

  return (
    <Sheet title={`Delete ${driver.name}`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="red">
          This permanently deletes the driver, their agreements, every payment and deposit, extras, corrections and
          uploaded screenshots. It cannot be undone, and their link stops working.
        </Notice>
        <Notice tone="muted">
          If this driver really had the car and you are only ending the arrangement, use <strong>Take car back</strong>
          instead. That keeps the record of what they paid.
        </Notice>
        <Field label={`Type "${driver.name}" to confirm`}>
          <input className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        {error && <Notice tone="red">{error}</Notice>}
        <Button type="submit" variant="danger" disabled={busy || !matches}>
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
      </form>
    </Sheet>
  );
}

function DeleteVehicleButton({ vehicle, onDeleted, onClose }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete ${vehicle.make_model}? This can't be undone.`)) return;
    setBusy(true);
    setError("");
    const { error: deleteError } = await supabase.from("vehicles").delete().eq("id", vehicle.id);
    setBusy(false);
    if (deleteError) {
      setError(errorMessage(deleteError));
      return;
    }
    onDeleted?.();
    onClose();
  }

  return (
    <>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="button" variant="danger" disabled={busy} onClick={handleDelete}>
        {busy ? "Deleting…" : "Delete car"}
      </Button>
    </>
  );
}

export function MaintenanceSheet({ vehicle, serviceTypes, onClose, onSaved }) {
  const [serviceTypeId, setServiceTypeId] = useState(serviceTypes[0]?.id ?? "");
  const [performedOn, setPerformedOn] = useState(todayAccra());
  const [ownerCost, setOwnerCost] = useState("");
  const [note, setNote] = useState("");

  const { busy, error, handleSubmit } = useSubmit(async () => {
    await must(
      supabase.from("maintenance_logs").insert({
        vehicle_id: vehicle.id,
        service_type_id: serviceTypeId,
        performed_on: performedOn,
        owner_cost: Number(ownerCost || 0),
        note: note.trim() || null,
      })
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title="Log a service" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Service">
          <select className="input" required value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
            {serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Date done">
            <input className="input" type="date" required max={todayAccra()} value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} />
          </Field>
          <Field label="What you spent (GH₵)" hint="Leave at 0 if the driver paid it all.">
            <input {...moneyInput} min="0" placeholder="0" value={ownerCost} onChange={(e) => setOwnerCost(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Save service" />
      </form>
    </Sheet>
  );
}

export function VehicleCostSheet({ vehicle, onClose, onSaved }) {
  const [category, setCategory] = useState("insurance");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayAccra());
  const [note, setNote] = useState("");

  const { busy, error, handleSubmit } = useSubmit(async () => {
    await must(
      supabase.from("vehicle_costs").insert({
        vehicle_id: vehicle.id,
        category,
        amount: Number(amount),
        date,
        note: note.trim() || null,
      })
    );
    onSaved?.();
  }, onClose);

  return (
    <Sheet title="Add a cost" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Notice tone="muted">Money you spent on this car. It counts against the car's profit.</Notice>
        <Field label="What for">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="insurance">Insurance</option>
            <option value="roadworthy">Roadworthy</option>
            <option value="registration">Registration</option>
            <option value="repair">Repair</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Amount (GH₵)">
            <input {...moneyInput} min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" required max={todayAccra()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Add cost" />
      </form>
    </Sheet>
  );
}

// How often a service is due on this car, when it differs from the usual interval.
export function IntervalSheet({ vehicle, service, onClose, onSaved }) {
  const [days, setDays] = useState(String(service.interval_days));

  const { busy, error, handleSubmit } = useSubmit(async () => {
    await must(
      supabase.from("vehicle_service_intervals").upsert(
        { vehicle_id: vehicle.id, service_type_id: service.service_type_id, interval_days: Number(days) },
        { onConflict: "vehicle_id,service_type_id" }
      )
    );
    onSaved?.();
  }, onClose);

  async function useDefault() {
    await supabase
      .from("vehicle_service_intervals")
      .delete()
      .eq("vehicle_id", vehicle.id)
      .eq("service_type_id", service.service_type_id);
    onSaved?.();
    onClose();
  }

  return (
    <Sheet title={`${service.service_name} on this car`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Due every (days)" hint="Only for this car. Other cars keep the usual interval.">
          <input className="input" type="number" min="1" required value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label="Save interval" />
        <Button type="button" variant="ghost" onClick={useDefault}>
          Use the usual interval
        </Button>
      </form>
    </Sheet>
  );
}

export function ServiceTypeSheet({ serviceType, onClose, onSaved }) {
  const [name, setName] = useState(serviceType?.name ?? "");
  const [days, setDays] = useState(serviceType ? String(serviceType.default_interval_days) : "30");

  const { busy, error, handleSubmit } = useSubmit(async () => {
    const values = { name: name.trim(), default_interval_days: Number(days) };
    await must(
      serviceType
        ? supabase.from("service_types").update(values).eq("id", serviceType.id)
        : supabase.from("service_types").insert(values)
    );
    onSaved?.();
  }, onClose);

  async function archive() {
    if (!window.confirm(`Stop tracking ${serviceType.name}? Past records are kept.`)) return;
    await supabase.from("service_types").update({ archived: true }).eq("id", serviceType.id);
    onSaved?.();
    onClose();
  }

  return (
    <Sheet title={serviceType ? "Edit service" : "Add a service"} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Name">
          <input className="input" required placeholder="e.g. Oil change" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Due every (days)" hint="The usual interval. You can change it per car later.">
          <input className="input" type="number" min="1" required value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Footer busy={busy} error={error} label={serviceType ? "Save" : "Add service"} />
        {serviceType && (
          <Button type="button" variant="danger" onClick={archive}>
            Stop tracking this
          </Button>
        )}
      </form>
    </Sheet>
  );
}
