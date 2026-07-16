"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowPathIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  CloudIcon,
  CursorArrowRaysIcon,
  EyeIcon,
  LinkIcon,
  ListBulletIcon,
  LockClosedIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/16/solid";

import { cn } from "@/lib/utils";

type BentoCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  tone?: "paper" | "sky" | "meadow" | "lilac";
};

const toneStyles = {
  paper: "bg-surface-white",
  sky: "bg-linear-to-br from-white via-[#f2faff] to-[#dff3ff]",
  meadow: "bg-linear-to-br from-white via-[#fbfff8] to-[#eaf9df]",
  lilac: "bg-linear-to-br from-white via-[#fcfaff] to-[#eee9ff]",
} as const;

function BentoCard({ eyebrow, title, description, children, className, tone = "paper" }: BentoCardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-radius-3xl p-2 shadow-[0_0_0_1px_rgb(18_18_18/0.055),0_20px_55px_rgb(59_130_176/0.09)]",
        toneStyles[tone],
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-radius-xl bg-white/58 backdrop-blur-[2px]">
        <div className="flex flex-col gap-1.5 p-4">
          <p className="font-mono text-label-small tracking-wide text-sky-blue-accent">{eyebrow}</p>
          <dt className="text-balance text-lg font-medium tracking-tight text-near-black-primary-text sm:text-xl">{title}</dt>
          <dd className="max-w-[48ch] text-pretty text-base text-muted-gray sm:text-sm">{description}</dd>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-radius-xl bg-white/42">{children}</div>
      </div>
    </motion.div>
  );
}

function CanvasVisual() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="canvas-grid relative min-h-56 overflow-hidden p-4 sm:min-h-64">
      <div className="absolute inset-x-[7%] top-[10%] h-[74%] rounded-radius-xl bg-surface-white/62 outline-1 -outline-offset-1 outline-near-black-primary-text/12">
        <p className="absolute top-3 left-4 font-mono text-label-small text-muted-gray">RESEARCH SIGNALS</p>
        <article className="absolute top-[24%] left-[7%] w-[36%] rounded-radius-lg bg-[#fff0ad] p-3 shadow-sm">
          <p className="font-mono text-label-small text-near-black-primary-text/55">INTERVIEW 04</p>
          <h4 className="pt-2 font-medium text-near-black-primary-text">Trust starts before sign-up</h4>
        </article>
        <article className="absolute top-[20%] right-[8%] w-[37%] rounded-radius-lg bg-[#dff2ff] p-3 shadow-sm">
          <p className="font-mono text-label-small text-near-black-primary-text/55">USABILITY TEST</p>
          <h4 className="pt-2 font-medium text-near-black-primary-text">A blank start feels slow</h4>
        </article>
        <article className="absolute bottom-[10%] left-[20%] w-[46%] rounded-radius-lg bg-slate-button-dark p-3 text-white shadow-sm">
          <p className="font-mono text-label-small text-white/55">WORKING SUMMARY</p>
          <h4 className="pt-2 font-medium">Make progress visible and keep evidence attached.</h4>
        </article>
      </div>

      <motion.div
        className="absolute top-[36%] left-[49%] flex items-start"
        animate={reduceMotion ? undefined : { x: [0, 18, 8, 0], y: [0, 8, 18, 0] }}
        transition={{ duration: 4.8, repeat: 1, repeatDelay: 0.4, ease: "easeInOut" }}
      >
        <CursorArrowRaysIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
        <p className="rounded-radius-sm bg-sky-blue-accent px-1.5 py-0.5 font-mono text-label-small text-white">ROWAN</p>
      </motion.div>

      <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-radius-pill bg-surface-white/90 py-2 pr-3 pl-2 shadow-sm ring-1 ring-near-black-primary-text/8 backdrop-blur-md">
        <CheckCircleIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
        <p className="font-medium text-near-black-primary-text">Saved locally</p>
      </div>
    </div>
  );
}

function PresenceVisual() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative flex min-h-56 flex-col justify-between overflow-hidden p-4 sm:min-h-64">
      <div className="flex items-center justify-between gap-4">
        <div className="flex -space-x-2">
          {["AM", "RK", "JD"].map((name, index) => (
            <div
              key={name}
              className="grid size-10 place-items-center rounded-full bg-slate-button-dark font-mono text-label-small text-white ring-2 ring-light-surface-tint"
            >
              {name}
              {index === 1 ? <span className="sr-only">, active now</span> : null}
            </div>
          ))}
        </div>
        <p className="rounded-radius-pill bg-surface-white px-3 py-1.5 font-mono text-label-small text-muted-gray ring-1 ring-border-subtle">3 HERE</p>
      </div>

      <div className="relative flex-1">
        <motion.div
          className="absolute top-[22%] left-[10%] flex items-start"
          animate={reduceMotion ? undefined : { x: [0, 52, 24, 0], y: [0, 26, 58, 0] }}
          transition={{ duration: 5.6, repeat: 1, repeatDelay: 0.4, ease: "easeInOut" }}
        >
          <CursorArrowRaysIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
          <p className="rounded-radius-sm bg-sky-blue-accent px-1.5 py-0.5 font-mono text-label-small text-white">ARUN</p>
        </motion.div>
        <motion.div
          className="absolute right-[10%] bottom-[18%] flex items-start"
          animate={reduceMotion ? undefined : { x: [0, -30, -12, 0], y: [0, -22, 10, 0] }}
          transition={{ duration: 5.2, repeat: 1, repeatDelay: 0.4, ease: "easeInOut", delay: 0.5 }}
        >
          <CursorArrowRaysIcon className="size-4 shrink-0 fill-slate-button-dark" aria-hidden="true" />
          <p className="rounded-radius-sm bg-slate-button-dark px-1.5 py-0.5 font-mono text-label-small text-white">MAYA</p>
        </motion.div>
      </div>

      <div className="flex items-start gap-2 border-t border-near-black-primary-text/8 pt-4">
        <UserGroupIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
        <p className="text-pretty text-base text-muted-gray sm:text-sm">Remote cursors inform. Your focus stays yours.</p>
      </div>
    </div>
  );
}

function OfflineVisual() {
  const [offline, setOffline] = useState(true);
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex min-h-56 flex-col justify-between gap-5 p-4 sm:min-h-64">
      <div className="flex items-center justify-between gap-4">
        <CloudIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={offline}
          onClick={() => setOffline((value) => !value)}
          className="relative rounded-radius-pill bg-surface-white px-3 py-2 font-medium text-near-black-primary-text outline-none ring-1 ring-near-black-primary-text/10 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform"
        >
          {offline ? "Reconnect" : "Go Offline"}
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-radius-xl bg-surface-white p-4 ring-1 ring-near-black-primary-text/8">
          <div className="flex items-center gap-2">
            <motion.div
              className={cn("size-2 shrink-0 rounded-full", offline ? "bg-[#d48723]" : "bg-sky-blue-accent")}
              animate={reduceMotion ? undefined : { opacity: [1, 0.55, 1] }}
              transition={{ duration: 1.5, repeat: 2 }}
            />
            <p className="font-medium text-near-black-primary-text">{offline ? "Offline — saved on this device" : "Online — synced to workspace"}</p>
          </div>
          <p className="pt-2 text-pretty text-base text-muted-gray sm:text-sm">
            {offline ? "Editing continues. Cloud sync waits without blocking the board." : "Local edits merged. Nothing moved under your pointer."}
          </p>
        </div>

        <div className="flex flex-col gap-2 font-mono text-label-small text-muted-gray">
          <div className="flex items-center justify-between gap-3"><p>LOCAL SAVE</p><p className="text-near-black-primary-text">CURRENT</p></div>
          <div className="h-1.5 overflow-hidden rounded-radius-pill bg-surface-white">
            <div className="h-full rounded-radius-pill bg-sky-blue-accent" />
          </div>
          <div className="flex items-center justify-between gap-3"><p>CLOUD SYNC</p><p className="text-near-black-primary-text">{offline ? "PAUSED" : "CURRENT"}</p></div>
          <div className="h-1.5 overflow-hidden rounded-radius-pill bg-surface-white">
            <motion.div
              className="h-full rounded-radius-pill bg-sky-blue-accent"
              animate={{ scaleX: offline ? 0.38 : 1 }}
              initial={false}
              style={{ transformOrigin: "left center" }}
              transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AiProposalVisual() {
  const [status, setStatus] = useState<"pending" | "applied" | "discarded">("pending");

  return (
    <div className="relative min-h-[26rem] overflow-hidden p-3 sm:min-h-64 sm:p-4">
      <div className="flex min-h-[24.5rem] flex-col rounded-radius-xl border-2 border-dashed border-sky-blue-accent/55 bg-sky-blue-accent/8 p-4 sm:min-h-[15rem]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <SparklesIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
            <div>
              <p className="font-medium text-near-black-primary-text">Cluster by onboarding theme</p>
              <p className="pt-1 text-base text-muted-gray sm:text-sm">3 typed changes · selected context only</p>
            </div>
          </div>
          <p className="rounded-radius-pill bg-surface-white px-2.5 py-1 font-mono text-label-small text-sky-blue-accent ring-1 ring-sky-blue-accent/16">PROPOSAL</p>
        </div>

        <div className="grid gap-2 pt-5 sm:grid-cols-3">
          {["Create theme frame", "Move 4 selected notes", "Create theme frame"].map((change, index) => (
            <motion.div
              key={`${change}-${index}`}
              className="flex items-start gap-2 rounded-radius-lg bg-surface-white p-3 ring-1 ring-near-black-primary-text/8"
              animate={{ opacity: status === "discarded" ? 0.36 : 1, y: status === "discarded" ? 4 : 0 }}
            >
              <CheckCircleIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
              <p className="font-medium text-near-black-primary-text">{change}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-auto flex flex-col items-start justify-between gap-3 border-t border-sky-blue-accent/16 pt-4 sm:flex-row sm:items-center">
          <p className="font-mono text-label-small text-muted-gray">
            {status === "pending" ? "NOTHING APPLIED YET" : status === "applied" ? "PATCH APPLIED · ONE UNDO STEP" : "PROPOSAL DISCARDED"}
          </p>
          {status === "pending" ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <button type="button" onClick={() => setStatus("discarded")} className="relative rounded-radius-pill px-3 py-2 font-medium text-muted-gray outline-none hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-sky-blue-accent transition-transform">
                Discard Proposal
                <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setStatus("applied")} className="relative rounded-radius-pill bg-sky-blue-accent px-3 py-2 font-medium text-white outline-none ring-1 ring-sky-blue-accent hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform">
                Apply 3 Changes
                <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setStatus("pending")} className="relative inline-flex items-center gap-2 rounded-radius-pill bg-surface-white py-2 pr-3 pl-2 font-medium text-near-black-primary-text outline-none ring-1 ring-near-black-primary-text/10 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform">
              <ArrowPathIcon className="size-4 h-lh shrink-0 fill-muted-gray" aria-hidden="true" />
              Reset Proposal
              <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentVisual() {
  const [resolved, setResolved] = useState(false);

  return (
    <div className="relative flex min-h-56 flex-col justify-between gap-4 p-4 sm:min-h-64">
      <div className="relative rounded-radius-xl bg-[#fff0ad] p-4 shadow-sm">
        <p className="font-mono text-label-small text-near-black-primary-text/55">INTERVIEW 04</p>
        <p className="pt-2 font-medium text-near-black-primary-text">Trust starts before sign-up</p>
        <div className="absolute -right-2 -bottom-2 grid size-7 place-items-center rounded-full bg-sky-blue-accent font-mono text-label-small text-white ring-2 ring-light-surface-tint">1</div>
      </div>

      <div className="rounded-radius-xl bg-surface-white p-4 shadow-sm ring-1 ring-near-black-primary-text/8">
        <div className="flex items-start gap-3">
          <ChatBubbleLeftRightIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-near-black-primary-text">Rowan Kim</p>
            <p className="pt-1 text-pretty text-base text-muted-gray sm:text-sm">Separate privacy expectations from the invite flow here.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setResolved((value) => !value)}
          className="relative flex w-fit items-center gap-2 pt-4 font-medium text-sky-blue-accent outline-none hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-sky-blue-accent transition-transform"
        >
          <CheckCircleIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
          {resolved ? "Reopen Thread" : "Resolve Thread"}
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SemanticVisual() {
  const [view, setView] = useState<"canvas" | "list">("list");

  return (
    <div className="flex min-h-56 flex-col gap-4 p-4 sm:min-h-64">
      <div className="flex w-fit items-center gap-1 rounded-radius-pill bg-surface-white p-1 ring-1 ring-near-black-primary-text/8">
        <button type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")} className={cn("relative flex items-center gap-1.5 rounded-radius-pill py-2 pr-3 pl-2 font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent", view === "canvas" ? "bg-slate-button-dark text-white" : "text-muted-gray")}>
          <EyeIcon className={cn("size-4 h-lh shrink-0", view === "canvas" ? "fill-white" : "fill-muted-gray")} aria-hidden="true" />
          Canvas
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        </button>
        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("relative flex items-center gap-1.5 rounded-radius-pill py-2 pr-3 pl-2 font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent", view === "list" ? "bg-slate-button-dark text-white" : "text-muted-gray")}>
          <ListBulletIcon className={cn("size-4 h-lh shrink-0", view === "list" ? "fill-white" : "fill-muted-gray")} aria-hidden="true" />
          List
          <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-radius-xl bg-surface-white ring-1 ring-near-black-primary-text/8">
        {view === "list" ? (
          <ol role="list" className="divide-y divide-near-black-primary-text/8">
            {["Trust starts before sign-up", "A blank start feels slow", "Offline confidence is visible"].map((item, index) => (
              <li key={item} className="grid grid-cols-[2rem_1fr] gap-3 px-4 py-3">
                <p className="font-mono text-label-small text-muted-gray">0{index + 1}</p>
                <p className="font-medium text-near-black-primary-text">{item}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="canvas-grid relative h-full min-h-44">
            <div className="absolute top-[18%] left-[10%] h-16 w-28 rotate-[-2deg] rounded-radius-md bg-[#fff0ad] shadow-sm" />
            <div className="absolute top-[26%] right-[10%] h-16 w-28 rotate-[2deg] rounded-radius-md bg-[#dff2ff] shadow-sm" />
            <div className="absolute bottom-[13%] left-[30%] h-16 w-36 rounded-radius-md bg-slate-button-dark shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function ShareVisual() {
  return (
    <div className="flex min-h-56 flex-col justify-between gap-5 p-4 sm:min-h-64">
      <div className="flex items-start gap-3">
        <LinkIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
        <div>
          <p className="font-medium text-near-black-primary-text">Research review</p>
          <p className="pt-1 font-mono text-label-small text-muted-gray">BOARD-SCOPED SHARE LINK</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 border-b border-near-black-primary-text/8 pb-3">
          <div className="flex items-center gap-2"><EyeIcon className="size-4 h-lh shrink-0 fill-muted-gray" aria-hidden="true" /><p className="text-muted-gray">Permission</p></div>
          <p className="font-medium text-near-black-primary-text">View only</p>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-near-black-primary-text/8 pb-3">
          <div className="flex items-center gap-2"><LockClosedIcon className="size-4 h-lh shrink-0 fill-muted-gray" aria-hidden="true" /><p className="text-muted-gray">Scope</p></div>
          <p className="font-medium text-near-black-primary-text">This board</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2"><BoltIcon className="size-4 h-lh shrink-0 fill-muted-gray" aria-hidden="true" /><p className="text-muted-gray">Expiry</p></div>
          <p className="font-medium text-near-black-primary-text">7 days</p>
        </div>
      </div>

      <p className="rounded-radius-xl bg-sky-blue-accent/8 p-3 text-pretty text-base text-sky-blue-accent sm:text-sm">Editing tools and workspace navigation stay unavailable.</p>
    </div>
  );
}

export interface AgentBentoGridProps {
  className?: string;
}

export function AgentBentoGrid({ className }: AgentBentoGridProps) {
  return (
    <dl className={cn("grid w-full grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12", className)}>
      <BentoCard
        eyebrow="LOCAL-FIRST CANVAS"
        title="One surface, with the evidence intact."
        description="Arrange source material and synthesis together, then move from signal to decision without losing the path back."
        className="lg:col-span-8"
        tone="sky"
      >
        <CanvasVisual />
      </BentoCard>

      <BentoCard
        eyebrow="LIVE PRESENCE"
        title="Awareness without interruption."
        description="See who is here and where they are working while local focus remains untouched."
        className="lg:col-span-4"
        tone="meadow"
      >
        <PresenceVisual />
      </BentoCard>

      <BentoCard
        eyebrow="OFFLINE CONTRACT"
        title="The board keeps working."
        description="Local save and cloud sync are separate, explicit states you can inspect."
        className="lg:col-span-4"
      >
        <OfflineVisual />
      </BentoCard>

      <BentoCard
        eyebrow="REVIEWABLE AI"
        title="AI proposes. You approve."
        description="Inspect each typed change before it applies, then reverse the accepted patch as one action."
        className="lg:col-span-8"
        tone="lilac"
      >
        <AiProposalVisual />
      </BentoCard>

      <BentoCard
        eyebrow="CONTEXTUAL COMMENTS"
        title="Feedback stays attached."
        description="Anchor a thread to the exact object and preserve its resolution history."
        className="lg:col-span-4"
        tone="meadow"
      >
        <CommentVisual />
      </BentoCard>

      <BentoCard
        eyebrow="SEMANTIC VIEW"
        title="Every object has a readable route."
        description="Switch between spatial canvas and synchronized reading order without losing content."
        className="lg:col-span-4"
        tone="sky"
      >
        <SemanticVisual />
      </BentoCard>

      <BentoCard
        eyebrow="SCOPED SHARING"
        title="Review without over-sharing."
        description="Create a board-only, expiring link with clear permissions and no workspace chrome."
        className="lg:col-span-4"
      >
        <ShareVisual />
      </BentoCard>
    </dl>
  );
}

export default AgentBentoGrid;
