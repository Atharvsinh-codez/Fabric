"use client";

import {
  ArrowsRightLeftIcon,
  BackspaceIcon,
  CalculatorIcon,
  ChartBarSquareIcon,
  ChevronDownIcon,
  MapIcon,
  ScaleIcon,
  TableCellsIcon,
  VariableIcon,
} from "@heroicons/react/16/solid";
import {
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import type { Editor } from "tldraw";

import { Button, IconButton, cx } from "@/components/ui";
import { calculateStudyExpression } from "@/lib/boards/study-calculator";
import {
  STEM_UNIT_CATEGORIES,
  convertStemUnit,
  sampleStemGraph,
  validateStemEquationCard,
  type StemGraphRequest,
  type StemGraphResult,
  type StemUnitCategoryId,
  type StemUnitId,
} from "@/lib/boards/stem-math";
import { insertCalculationCard } from "@/lib/boards/tldraw-study-tools";
import {
  STEM_INSTRUMENTS,
  insertStemConversionCard,
  insertStemEquationCard,
  insertStemGraph,
  insertStemInstrument,
  type StemInstrumentId,
} from "@/lib/boards/tldraw-stem-tools";

type StemMode = "calculator" | "graph" | "convert" | "equation" | "tools";
type StemIcon = ComponentType<SVGProps<SVGSVGElement>>;
type Announce = (message: string) => void;

const modes: readonly Readonly<{ id: StemMode; label: string }>[] = [
  { id: "calculator", label: "Calculator" },
  { id: "graph", label: "Graph" },
  { id: "convert", label: "Convert" },
  { id: "equation", label: "Equation" },
  { id: "tools", label: "Tools" },
];

const calculatorKeys = [
  { label: "7", value: "7", name: "Seven" },
  { label: "8", value: "8", name: "Eight" },
  { label: "9", value: "9", name: "Nine" },
  { label: "\u00f7", value: "\u00f7", name: "Divide" },
  { label: "sqrt", value: "sqrt(", name: "Square Root" },
  { label: "4", value: "4", name: "Four" },
  { label: "5", value: "5", name: "Five" },
  { label: "6", value: "6", name: "Six" },
  { label: "\u00d7", value: "\u00d7", name: "Multiply" },
  { label: "^", value: "^", name: "Power" },
  { label: "1", value: "1", name: "One" },
  { label: "2", value: "2", name: "Two" },
  { label: "3", value: "3", name: "Three" },
  { label: "\u2212", value: "\u2212", name: "Subtract" },
  { label: "(", value: "(", name: "Open Parenthesis" },
  { label: "0", value: "0", name: "Zero" },
  { label: ".", value: ".", name: "Decimal Point" },
  { label: "\u03c0", value: "\u03c0", name: "Pi" },
  { label: "+", value: "+", name: "Add" },
  { label: ")", value: ")", name: "Close Parenthesis" },
] as const;

const instrumentIcons: Record<StemInstrumentId, StemIcon> = {
  ruler: ScaleIcon,
  protractor: ArrowsRightLeftIcon,
  "coordinate-plane": TableCellsIcon,
};

const fieldClass =
  "h-10 min-w-0 w-full rounded-radius-md bg-surface-white px-2.5 text-base tabular-nums text-near-black-primary-text outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm";

type InsertionResult =
  | Readonly<{ ok: true; name: string }>
  | Readonly<{ ok: false; reason: string; message?: string }>;

function reportInsertion(result: InsertionResult, onAnnouncement: Announce): void {
  if (result.ok) {
    onAnnouncement(`${result.name} added to the board.`);
    return;
  }
  if (result.message) {
    onAnnouncement(result.message);
    return;
  }
  if (result.reason === "readonly") {
    onAnnouncement("This board is view-only. Ask an owner for edit access before adding STEM tools.");
  } else if (result.reason === "capacity") {
    onAnnouncement("The board could not fit those shapes. Remove unused content and try again.");
  } else {
    onAnnouncement("The whiteboard is still loading. Try adding the STEM tool again.");
  }
}

function parseNumber(value: string): number {
  return value.trim() ? Number(value) : Number.NaN;
}

function PanelIntro({ icon: Icon, children }: { icon: StemIcon; children: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-radius-lg bg-light-surface-tint p-3">
      <Icon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
      <p className="text-pretty text-base text-muted-gray sm:text-sm">{children}</p>
    </div>
  );
}

function CalculatorMode({ editor, onAnnouncement }: { editor: Editor | null; onAnnouncement: Announce }) {
  const [expression, setExpression] = useState("");
  const calculation = useMemo(() => calculateStudyExpression(expression), [expression]);

  const addCalculation = () => {
    if (!calculation.ok) return;
    reportInsertion(insertCalculationCard(editor, calculation), onAnnouncement);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="fabric-stem-calculation" className="font-medium">
          Expression
        </label>
        <div className="flex items-center gap-1 rounded-radius-lg bg-surface-white p-1 ring-1 ring-near-black-primary-text/10 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-sky-blue-accent">
          <CalculatorIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
          <input
            id="fabric-stem-calculation"
            name="stem-calculation"
            value={expression}
            maxLength={160}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Try (12.5 * 4) + sqrt(81)"
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-gray sm:h-8 sm:text-sm"
            onChange={(event) => setExpression(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && calculation.ok) {
                event.preventDefault();
                addCalculation();
              }
            }}
          />
          <IconButton
            label="Delete Last Calculator Character"
            tooltipSide="top"
            disabled={!expression}
            onClick={() => setExpression((current) => current.slice(0, -1))}
          >
            <BackspaceIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div
        key={calculation.ok ? calculation.display : calculation.message}
        className={cx(
          "min-h-20 rounded-radius-lg p-3 ring-1 review-panel-enter",
          calculation.ok
            ? "bg-(--accent-soft) ring-sky-blue-accent/20"
            : expression
              ? "bg-(--danger-soft) ring-(--danger-border)"
              : "bg-light-surface-tint ring-near-black-primary-text/5",
        )}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {calculation.ok ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-base text-muted-gray sm:text-sm">{calculation.expression}</p>
            <p className="break-all text-2xl font-medium tracking-tight tabular-nums text-sky-blue-accent">
              = {calculation.display}
            </p>
          </div>
        ) : (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            {expression
              ? calculation.message
              : "Enter an expression or use the keypad. Percent divides the value before it by 100."}
          </p>
        )}
      </div>

      <div className="grid grid-cols-5 gap-1.5" aria-label="STEM Calculator Keypad">
        {calculatorKeys.map((key) => (
          <button
            key={key.name}
            type="button"
            aria-label={key.name}
            className="relative h-12 rounded-radius-md bg-light-surface-tint text-base font-medium outline-none hover:bg-(--accent-soft) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent motion-reduce:transform-none sm:h-9 sm:text-sm"
            onClick={() => setExpression((current) => `${current}${key.value}`.slice(0, 160))}
          >
            {key.label}
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button tone="ghost" disabled={!expression} onClick={() => setExpression("")}>
          Clear Expression
        </Button>
        <Button
          tone="primary"
          disabled={!editor || !calculation.ok}
          leading={<CalculatorIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={addCalculation}
        >
          Add Result
        </Button>
      </div>
    </div>
  );
}

function GraphPreview({ graph }: { graph: StemGraphResult }) {
  if (!graph.ok) {
    return (
      <div className="min-h-36 rounded-radius-lg bg-(--danger-soft) p-3 ring-1 ring-(--danger-border)" role="status">
        <p className="text-pretty text-base text-(--danger) sm:text-sm">{graph.message}</p>
      </div>
    );
  }

  const width = 320;
  const height = 168;
  const mapX = (x: number) => ((x - graph.xMin) / (graph.xMax - graph.xMin)) * width;
  const mapY = (y: number) => ((graph.yMax - y) / (graph.yMax - graph.yMin)) * height;
  const paths = graph.segments.map((segment) =>
    segment
      .map((point, index) => `${index === 0 ? "M" : "L"}${mapX(point.x).toFixed(2)} ${mapY(point.y).toFixed(2)}`)
      .join(" "),
  );
  const xAxis = graph.yMin <= 0 && graph.yMax >= 0 ? mapY(0) : null;
  const yAxis = graph.xMin <= 0 && graph.xMax >= 0 ? mapX(0) : null;

  return (
    <div className="overflow-hidden rounded-radius-lg bg-surface-white ring-1 ring-near-black-primary-text/10">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-near-black-primary-text/8 px-3 py-2">
        <p className="min-w-0 truncate font-medium">Live Preview</p>
        <p className="shrink-0 text-base tabular-nums text-muted-gray sm:text-sm">
          {graph.xMin} to {graph.xMax}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full bg-light-surface-tint"
        role="img"
        aria-label={`Preview of y equals ${graph.expression}`}
      >
        {Array.from({ length: 11 }, (_, index) => {
          const x = (width * index) / 10;
          const y = (height * index) / 10;
          return (
            <g key={index}>
              <line x1={x} y1={0} x2={x} y2={height} className="stroke-near-black-primary-text/8" />
              <line x1={0} y1={y} x2={width} y2={y} className="stroke-near-black-primary-text/8" />
            </g>
          );
        })}
        {xAxis === null ? null : (
          <line x1={0} y1={xAxis} x2={width} y2={xAxis} className="stroke-near-black-primary-text/45" />
        )}
        {yAxis === null ? null : (
          <line x1={yAxis} y1={0} x2={yAxis} y2={height} className="stroke-near-black-primary-text/45" />
        )}
        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="none"
            vectorEffect="non-scaling-stroke"
            className="stroke-sky-blue-accent [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
          />
        ))}
      </svg>
    </div>
  );
}

function GraphMode({ editor, onAnnouncement }: { editor: Editor | null; onAnnouncement: Announce }) {
  const [expression, setExpression] = useState("sin(x)");
  const [xMin, setXMin] = useState("-10");
  const [xMax, setXMax] = useState("10");
  const [yMin, setYMin] = useState("-10");
  const [yMax, setYMax] = useState("10");
  const request = useMemo<StemGraphRequest>(
    () => ({
      expression,
      xMin: parseNumber(xMin),
      xMax: parseNumber(xMax),
      yMin: parseNumber(yMin),
      yMax: parseNumber(yMax),
      sampleCount: 121,
    }),
    [expression, xMax, xMin, yMax, yMin],
  );
  const graph = useMemo(() => sampleStemGraph(request), [request]);

  const addGraph = () => reportInsertion(insertStemGraph(editor, request), onAnnouncement);

  return (
    <div className="flex flex-col gap-4">
      <PanelIntro icon={ChartBarSquareIcon}>
        Plot a bounded function safely, preview it live, then add it as editable native shapes.
      </PanelIntro>
      <div className="flex flex-col gap-2">
        <label htmlFor="fabric-stem-graph-expression" className="font-medium">
          Function
        </label>
        <div className="flex items-center gap-2">
          <p className="shrink-0 text-base text-muted-gray sm:text-sm">y =</p>
          <input
            id="fabric-stem-graph-expression"
            name="stem-graph-expression"
            value={expression}
            maxLength={160}
            autoComplete="off"
            spellCheck={false}
            placeholder="sin(x) + x / 3"
            className={fieldClass}
            onChange={(event) => setExpression(event.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([
          ["x-min", "X Minimum", xMin, setXMin],
          ["x-max", "X Maximum", xMax, setXMax],
          ["y-min", "Y Minimum", yMin, setYMin],
          ["y-max", "Y Maximum", yMax, setYMax],
        ] as const).map(([id, label, value, update]) => (
          <div key={id} className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`fabric-stem-${id}`} className="text-base font-medium sm:text-sm">
              {label}
            </label>
            <input
              id={`fabric-stem-${id}`}
              name={`stem-${id}`}
              value={value}
              inputMode="decimal"
              autoComplete="off"
              className={fieldClass}
              onChange={(event) => update(event.target.value)}
            />
          </div>
        ))}
      </div>
      <GraphPreview graph={graph} />
      <div className="flex justify-end">
        <Button
          tone="primary"
          disabled={!editor || !graph.ok}
          leading={<ChartBarSquareIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={addGraph}
        >
          Add Graph
        </Button>
      </div>
    </div>
  );
}

type SelectOption = Readonly<{ value: string; label: string }>;

function SelectField({
  id,
  name,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="grid min-w-0 grid-cols-[1fr_--spacing(8)]">
        <select
          id={id}
          name={name}
          value={value}
          className={`${fieldClass} col-span-full row-start-1 appearance-none pr-8`}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          className="pointer-events-none col-start-2 row-start-1 size-4 place-self-center fill-muted-gray"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function ConvertMode({ editor, onAnnouncement }: { editor: Editor | null; onAnnouncement: Announce }) {
  const [categoryId, setCategoryId] = useState<StemUnitCategoryId>("length");
  const [from, setFrom] = useState<StemUnitId>("m");
  const [to, setTo] = useState<StemUnitId>("km");
  const [value, setValue] = useState("1");
  const category = STEM_UNIT_CATEGORIES.find((candidate) => candidate.id === categoryId)
    ?? STEM_UNIT_CATEGORIES[0];
  const request = useMemo(
    () => ({ category: categoryId, value: parseNumber(value), from, to }),
    [categoryId, from, to, value],
  );
  const conversion = useMemo(() => convertStemUnit(request), [request]);

  const chooseCategory = (nextId: string) => {
    const next = STEM_UNIT_CATEGORIES.find((candidate) => candidate.id === nextId);
    if (!next) return;
    setCategoryId(next.id);
    setFrom(next.units[0].id);
    setTo((next.units[1] ?? next.units[0]).id);
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelIntro icon={ArrowsRightLeftIcon}>
        Convert common science and classroom units, then keep the worked result on your board.
      </PanelIntro>
      <SelectField
        id="fabric-stem-unit-category"
        name="stem-unit-category"
        label="Category"
        value={categoryId}
        options={STEM_UNIT_CATEGORIES.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        onChange={chooseCategory}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fabric-stem-unit-value" className="font-medium">
          Value
        </label>
        <input
          id="fabric-stem-unit-value"
          name="stem-unit-value"
          value={value}
          inputMode="decimal"
          autoComplete="off"
          className={fieldClass}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <SelectField
          id="fabric-stem-unit-from"
          name="stem-unit-from"
          label="From"
          value={from}
          options={category.units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.symbol})` }))}
          onChange={(next) => setFrom(next as StemUnitId)}
        />
        <IconButton
          label="Swap Conversion Units"
          tooltipSide="top"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowsRightLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
        <SelectField
          id="fabric-stem-unit-to"
          name="stem-unit-to"
          label="To"
          value={to}
          options={category.units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.symbol})` }))}
          onChange={(next) => setTo(next as StemUnitId)}
        />
      </div>
      <div
        key={conversion.ok ? conversion.display : conversion.message}
        className={cx(
          "rounded-radius-lg p-3 ring-1 review-panel-enter",
          conversion.ok
            ? "bg-(--accent-soft) ring-sky-blue-accent/20"
            : "bg-(--danger-soft) ring-(--danger-border)",
        )}
        role="status"
        aria-live="polite"
      >
        {conversion.ok ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base text-muted-gray sm:text-sm">
              {conversion.value} {conversion.from.symbol} equals
            </p>
            <p className="break-all text-2xl font-medium tracking-tight tabular-nums text-sky-blue-accent">
              {conversion.display} {conversion.to.symbol}
            </p>
          </div>
        ) : (
          <p className="text-pretty text-base text-(--danger) sm:text-sm">{conversion.message}</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          tone="primary"
          disabled={!editor || !conversion.ok}
          leading={<ArrowsRightLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={() => reportInsertion(insertStemConversionCard(editor, request), onAnnouncement)}
        >
          Add Conversion
        </Button>
      </div>
    </div>
  );
}

function EquationMode({ editor, onAnnouncement }: { editor: Editor | null; onAnnouncement: Announce }) {
  const [title, setTitle] = useState("Equation");
  const [equation, setEquation] = useState("");
  const [note, setNote] = useState("");
  const input = useMemo(
    () => ({ title, equation, note: note.trim() || undefined }),
    [equation, note, title],
  );
  const validation = useMemo(() => validateStemEquationCard(input), [input]);

  return (
    <div className="flex flex-col gap-4">
      <PanelIntro icon={VariableIcon}>
        Turn a formula, identity, or worked step into an editable equation card for your notes.
      </PanelIntro>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fabric-stem-equation-title" className="font-medium">
          Title
        </label>
        <input
          id="fabric-stem-equation-title"
          name="stem-equation-title"
          value={title}
          maxLength={48}
          className={fieldClass}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fabric-stem-equation" className="font-medium">
          Equation
        </label>
        <input
          id="fabric-stem-equation"
          name="stem-equation"
          value={equation}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          placeholder="E = mc^2"
          className={fieldClass}
          onChange={(event) => setEquation(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fabric-stem-equation-note" className="font-medium">
          Note <span className="font-normal text-muted-gray">(Optional)</span>
        </label>
        <textarea
          id="fabric-stem-equation-note"
          name="stem-equation-note"
          value={note}
          maxLength={280}
          rows={3}
          placeholder="Define the variables, derivation, or units."
          className="min-h-24 w-full resize-y rounded-radius-md bg-surface-white p-2.5 text-base text-near-black-primary-text outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:text-sm"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div
        className={cx(
          "rounded-radius-lg p-4 ring-1",
          validation.ok
            ? "bg-(--accent-soft) ring-sky-blue-accent/20"
            : "bg-light-surface-tint ring-near-black-primary-text/5",
        )}
        role="status"
        aria-live="polite"
      >
        {validation.ok ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p className="truncate font-medium">{validation.card.title}</p>
            <p className="break-all text-xl font-medium tracking-tight text-near-black-primary-text">
              {validation.card.equation}
            </p>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">{validation.card.note}</p>
          </div>
        ) : (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">{validation.message}</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          tone="primary"
          disabled={!editor || !validation.ok}
          leading={<VariableIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={() => reportInsertion(insertStemEquationCard(editor, input), onAnnouncement)}
        >
          Add Equation
        </Button>
      </div>
    </div>
  );
}

function ToolsMode({ editor, onAnnouncement }: { editor: Editor | null; onAnnouncement: Announce }) {
  return (
    <div className="flex flex-col gap-4">
      <PanelIntro icon={MapIcon}>
        Add measurement and coordinate guides as native shapes that everyone can move, edit, and annotate.
      </PanelIntro>
      <ul role="list">
        {STEM_INSTRUMENTS.map((instrument) => {
          const Icon = instrumentIcons[instrument.id];
          return (
            <li
              key={instrument.id}
              className="flex min-w-0 items-start gap-3 border-t border-near-black-primary-text/8 py-3 first:border-t-0 first:pt-0 last:pb-0"
            >
              <Icon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="font-medium">{instrument.name}</h3>
                <p className="text-pretty text-base text-muted-gray sm:text-sm">{instrument.description}</p>
              </div>
              <Button
                className="self-start"
                disabled={!editor}
                onClick={() => reportInsertion(insertStemInstrument(editor, instrument.id), onAnnouncement)}
              >
                Add Tool
                <span
                  className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                  aria-hidden="true"
                />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FabricStemToolkitPanel({
  editor,
  onAnnouncement,
}: {
  editor: Editor | null;
  onAnnouncement: Announce;
}) {
  const [mode, setMode] = useState<StemMode>("calculator");

  return (
    <section aria-label="STEM Toolkit" className="flex min-w-0 flex-col gap-4">
      <div
        className="flex min-w-0 gap-1 overflow-x-auto rounded-radius-lg bg-light-surface-tint p-1"
        role="tablist"
        aria-label="STEM Tool Categories"
      >
        {modes.map((item) => (
          <button
            key={item.id}
            id={`fabric-stem-${item.id}-tab`}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            aria-controls={`fabric-stem-${item.id}-panel`}
            className={cx(
              "relative h-10 shrink-0 rounded-radius-md px-0.5 text-[0.9375rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8 sm:px-1 sm:text-sm",
              mode === item.id
                ? "bg-surface-white text-near-black-primary-text ring-1 ring-near-black-primary-text/8"
                : "text-muted-gray hover:text-near-black-primary-text",
            )}
            onClick={() => setMode(item.id)}
          >
            {item.label}
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

      <div
        id={`fabric-stem-${mode}-panel`}
        role="tabpanel"
        aria-labelledby={`fabric-stem-${mode}-tab`}
        className="min-w-0"
      >
        {mode === "calculator" ? (
          <CalculatorMode editor={editor} onAnnouncement={onAnnouncement} />
        ) : mode === "graph" ? (
          <GraphMode editor={editor} onAnnouncement={onAnnouncement} />
        ) : mode === "convert" ? (
          <ConvertMode editor={editor} onAnnouncement={onAnnouncement} />
        ) : mode === "equation" ? (
          <EquationMode editor={editor} onAnnouncement={onAnnouncement} />
        ) : (
          <ToolsMode editor={editor} onAnnouncement={onAnnouncement} />
        )}
      </div>
    </section>
  );
}
