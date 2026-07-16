import {
  ArrowPathIcon,
  ArrowRightIcon,
  BoltIcon,
  CheckCircleIcon,
  CircleStackIcon,
  CloudArrowUpIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  CursorArrowRaysIcon,
  DevicePhoneMobileIcon,
  DocumentCheckIcon,
  EyeIcon,
  FingerPrintIcon,
  KeyIcon,
  LanguageIcon,
  NoSymbolIcon,
  QueueListIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquaresPlusIcon,
  UserGroupIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon, MinusIcon } from "@heroicons/react/16/solid";
import Image from "next/image";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { MarketingShell } from "@/components/marketing-shell";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const pageContainer = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";
const primaryLink =
  "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-radius-pill bg-sky-blue-accent py-3 pr-4 pl-5 font-medium text-white outline-none ring-1 ring-sky-blue-accent hover:-translate-y-px hover:bg-sky-blue-accent/90 active:translate-y-0 active:bg-sky-blue-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform";
const secondaryLink =
  "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-radius-pill bg-surface-white px-4 py-3 font-medium text-muted-gray outline-none ring-1 ring-near-black-primary-text/10 hover:-translate-y-px hover:text-near-black-primary-text active:translate-y-0 active:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-sm uppercase tracking-wide text-sky-blue-accent">{children}</p>;
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
      <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">{description}</p>
    </div>
  );
}

function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <aside className="rounded-radius-xl border-l-2 border-sky-blue-accent bg-sky-blue-accent/8 px-4 py-3" aria-label="Product status">
      <p className="max-w-[72ch] text-pretty text-base text-muted-gray">{children}</p>
    </aside>
  );
}

function MarketingCta({
  title,
  description,
  href = "/app",
  label = "Get started",
}: {
  title: string;
  description: string;
  href?: string;
  label?: string;
}) {
  return (
    <section className="bg-light-surface-tint py-12 sm:py-16">
      <div className={pageContainer}>
        <div className="grid gap-8 rounded-radius-4xl bg-slate-button-dark p-6 text-white sm:p-10 md:grid-cols-[3fr_2fr] md:items-end lg:p-12">
          <div className="flex flex-col gap-4">
            <p className="max-w-[24ch] text-balance font-display text-4xl font-normal tracking-[-0.025em] sm:text-5xl">{title}</p>
            <p className="max-w-[48ch] text-pretty text-lg text-white/70 sm:text-base">{description}</p>
          </div>
          <div className="flex md:justify-end">
            <Link
              href={href}
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-radius-pill border border-white/25 px-4 py-3 font-medium text-white outline-none hover:-translate-y-px hover:bg-white/10 active:translate-y-0 active:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-transform"
            >
              {label}
              <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const features: Array<{ icon: Icon; title: string; description: string }> = [
  {
    icon: CursorArrowRaysIcon,
    title: "Spatial freedom",
    description: "Arrange notes, text, shapes, images, frames, and connectors without choosing a document structure first.",
  },
  {
    icon: QueueListIcon,
    title: "Structured when needed",
    description: "Shared-board links pair a read-only visual canvas with an ordered semantic list of the saved board objects.",
  },
  {
    icon: UserGroupIcon,
    title: "Live collaboration",
    description: "Presence, comments, selections, and shared edits keep the team together without taking over local focus.",
  },
  {
    icon: CircleStackIcon,
    title: "Local-first persistence",
    description: "Fabric writes locally first, keeps visited work available offline, and merges authorized updates on reconnect.",
  },
  {
    icon: SparklesIcon,
    title: "Reviewable AI",
    description: "The clustering skill proposes theme frames and moves as a visible preview. An editor applies or discards the patch.",
  },
  {
    icon: DocumentCheckIcon,
    title: "Recoverable decisions",
    description: "Named checkpoints, comments, and bounded history preserve context before a workshop or broad rewrite.",
  },
];

export function FeaturesPage() {
  return (
    <MarketingShell>
      <main>
        <section className="relative min-h-[46rem] overflow-hidden bg-surface-white">
          <Image
            src="/images/fabric-evidence-sky-v4.webp"
            alt="Airy research cards and botanical samples connected with a cobalt thread"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[68%_center]"
          />
          <div className="absolute inset-0 bg-linear-to-r from-surface-white via-surface-white/94 to-surface-white/12 md:via-surface-white/78" aria-hidden="true" />
          <div className={`${pageContainer} relative flex min-h-[46rem] items-center py-16 sm:py-20 lg:py-24`}>
            <div className="flex max-w-2xl flex-col items-start gap-6">
              <Eyebrow>One canvas · Every phase of discovery</Eyebrow>
              <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
                From raw evidence to shared direction.
              </h1>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                Fabric brings research, diagrams, conversations, and decisions into one multiplayer workspace—then helps the team shape them without hiding the work.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/app" className={primaryLink}>
                  Get started
                  <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
                </Link>
                <Link href="#systems" className={secondaryLink}>
                  Explore the System
                </Link>
              </div>
              <StatusNote>
                Fabric now connects authenticated workspaces, durable board storage, offline recovery, scoped sharing, realtime collaboration, and streamed AI proposals. Operational guarantees still depend on the deployment and its monitoring, backups, and provider quotas.
              </StatusNote>
            </div>
            <p className="absolute right-5 bottom-5 rounded-radius-pill bg-surface-white/80 px-3 py-2 font-mono text-sm text-muted-gray backdrop-blur-md sm:right-8 sm:bottom-8 lg:right-10">
              Illustration · Evidence map
            </p>
          </div>
        </section>

        <section id="systems" className="border-y border-border-subtle bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="The system"
              title="Six capabilities, designed as one workflow."
              description="Fabric is not another whiteboard with features attached. Each layer exists to move a team from scattered input to a decision it can explain."
            />

            <dl className="grid gap-x-8 gap-y-0 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const FeatureIcon = feature.icon;
                return (
                  <div key={feature.title} className="flex gap-4 border-t border-border-subtle py-6">
                    <FeatureIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <div className="flex min-w-0 flex-col gap-2">
                      <dt className="font-medium text-near-black-primary-text">{feature.title}</dt>
                      <dd className="text-pretty text-lg text-muted-gray sm:text-base">{feature.description}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[5fr_7fr]`}>
            <SectionHeading
              eyebrow="Wedge workflow"
              title="A clearer path through product discovery."
              description="Keep the source material visible while the team moves from collection to synthesis, planning, and review."
            />

            <ol role="list" className="grid gap-0 sm:grid-cols-2">
              {[
                ["01", "Collect", "Drop in screenshots, quotes, constraints, and rough notes."],
                ["02", "Arrange", "Cluster evidence spatially and connect ideas without flattening context."],
                ["03", "Synthesize", "Ask the clustering skill to propose theme frames and a clearer arrangement."],
                ["04", "Decide", "Review the patch, discuss exact objects, and checkpoint the outcome."],
              ].map(([number, title, description], index) => (
                <li
                  key={number}
                  className={`flex flex-col gap-4 border-border-subtle py-6 sm:px-6 ${
                    index > 0 ? "border-t sm:border-t-0" : ""
                  } ${index % 2 === 1 ? "sm:border-l" : "sm:pr-6"} ${index >= 2 ? "sm:border-t" : ""}`}
                >
                  <p className="font-mono text-sm text-sky-blue-accent">{number}</p>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xl font-medium">{title}</h3>
                    <p className="text-pretty text-lg text-muted-gray sm:text-base">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-border-subtle bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-10`}>
            <SectionHeading
              eyebrow="Honest scope"
              title="A focused product, not an everything tool."
              description="The current product concentrates on reliable editing, durable collaboration, accessible reading, and explicit AI approval."
            />
            <div className="grid gap-8 md:grid-cols-3">
              {[
                ["Available now", "Authenticated workspaces, member roles, durable boards, comments, share links, canvas editing, local recovery, and reviewable AI proposals."],
                ["Service boundaries", "Realtime persistence, reconnecting local queues, health probes, and isolated database identities run as explicit application services."],
                ["Operational limits", "Multi-instance realtime fan-out, update compaction, independent security assurance, and contractual service levels are not asserted."],
              ].map(([title, description]) => (
                <div key={title} className="flex flex-col gap-3 border-t border-near-black-primary-text/15 pt-5">
                  <h3 className="font-medium">{title}</h3>
                  <p className="text-pretty text-lg text-muted-gray sm:text-base">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <MarketingCta
          title="See how the pieces feel together."
          description="Open your workspace, shape a board, and inspect every AI change before it becomes part of the canvas."
        />
      </main>
    </MarketingShell>
  );
}

const currentAccessFeatures = [
  "Persistent workspaces and role-aware boards",
  "Interactive canvas with local draft recovery",
  "Streamed AI proposals with explicit approval",
  "Responsive desktop and tablet layouts",
  "No payment method or billing flow",
];

export function PricingPage() {
  return (
    <MarketingShell>
      <main>
        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} flex flex-col items-center gap-6 text-center`}>
            <Eyebrow>Current access</Eyebrow>
            <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
              Use Fabric without a billing account.
            </h1>
            <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
              Fabric does not currently offer paid plans or collect payment details. Sign in with Google or GitHub to create a persistent workspace.
            </p>
          </div>
        </section>

        <section className="bg-surface-white pb-16 sm:pb-20 lg:pb-24">
          <div className={`${pageContainer} max-w-5xl`}>
            <div className="grid overflow-hidden rounded-radius-3xl bg-surface-white ring-1 ring-near-black-primary-text/15 lg:grid-cols-[5fr_4fr]">
              <div className="flex flex-col justify-between gap-10 p-6 sm:p-8 lg:p-10">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-medium tracking-tight">Fabric Workspace</h2>
                    <p className="rounded-radius-pill bg-sky-blue-accent/8 px-3 py-1 font-mono text-sm text-sky-blue-accent">Billing unavailable</p>
                  </div>
                  <div className="flex items-end gap-3">
                    <p className="text-5xl font-medium tracking-tight">No charge</p>
                    <p className="pb-1 text-base text-muted-gray">no payment details</p>
                  </div>
                  <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                    Create workspaces, invite existing Fabric accounts, collaborate on durable boards, and review AI proposals before applying them.
                  </p>
                  <ul role="list" className="flex flex-col gap-3">
                    {currentAccessFeatures.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-lg text-muted-gray sm:text-base">
                        <CheckIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <Link href="/app" className={primaryLink}>
                    Get started
                    <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-6 border-t border-border-subtle bg-light-surface-tint p-6 sm:p-8 lg:border-t-0 lg:border-l lg:p-10">
                <p className="font-mono text-sm uppercase tracking-wide text-muted-gray">Included today</p>
                <h3 className="max-w-[30ch] text-balance text-2xl font-medium tracking-tight">One access path, with visible service boundaries.</h3>
                <dl className="flex flex-col gap-5">
                  {[
                    ["Identity", "Google and GitHub provide identity; Fabric stores database sessions without provider bearer tokens."],
                    ["Collaboration", "Workspace roles govern boards, comments, members, share links, and AI approval."],
                    ["Persistence", "Board data uses the configured Neon database, with device recovery state in IndexedDB."],
                    ["External services", "Live collaboration and AI depend on the configured realtime service, worker, and model-provider quota."],
                  ].map(([term, detail]) => (
                    <div key={term} className="flex flex-col gap-1 border-t border-border-subtle pt-4">
                      <dt className="font-medium text-near-black-primary-text">{term}</dt>
                      <dd className="text-pretty text-lg text-muted-gray sm:text-base">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="Operational boundaries"
              title="Access is simple; deployment dependencies stay visible."
              description="The product does not hide service configuration, storage, or assurance boundaries behind an invented pricing tier."
            />
            <div className="grid gap-8 md:grid-cols-3">
              {[
                [UserGroupIcon, "Workspace access", "Owners add existing Fabric accounts and assign owner, editor, commenter, or viewer roles."],
                [CircleStackIcon, "Service configuration", "Persistence, realtime, and AI capabilities report errors when their required services are unavailable."],
                [ShieldCheckIcon, "No assurance bundle", "No certification, support plan, retention SLA, or uptime commitment is included or implied."],
              ].map(([icon, title, description]) => {
                const PrincipleIcon = icon as Icon;
                return (
                  <div key={title as string} className="flex flex-col gap-4 border-t border-near-black-primary-text/15 pt-5">
                    <PrincipleIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <h3 className="text-xl font-medium">{title as string}</h3>
                    <p className="text-pretty text-lg text-muted-gray sm:text-base">{description as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-8`}>
            <div className="flex flex-col gap-3">
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">What exists today.</h2>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">A direct view of the current product surface and the external services each capability depends on.</p>
            </div>
            <div className="overflow-x-auto rounded-radius-3xl ring-1 ring-border-subtle">
              <table className="w-full min-w-2xl border-collapse text-left">
                <thead className="bg-light-surface-tint">
                  <tr>
                    <th scope="col" className="px-5 py-4 font-medium">Capability</th>
                    <th scope="col" className="px-5 py-4 font-medium">Current build</th>
                    <th scope="col" className="px-5 py-4 font-medium">Runtime dependency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-surface-white">
                  {[
                    ["Canvas editing and product UI", true, "Supported browser"],
                    ["Durable multiplayer sync", true, "Realtime service and Neon"],
                    ["Offline reopen and outbox", true, "IndexedDB-capable browser"],
                    ["Streaming AI proposals", true, "AI worker and OpenAI-compatible credentials"],
                    ["Payment and subscriptions", false, "No billing integration"],
                  ].map(([capability, available, dependency]) => (
                    <tr key={capability as string}>
                      <th scope="row" className="px-5 py-4 font-medium text-near-black-primary-text">{capability as string}</th>
                      <td className="px-5 py-4 text-muted-gray">
                        <span className="flex items-center gap-2">
                          {available ? (
                            <CheckIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                          ) : (
                            <MinusIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
                          )}
                          {available ? "Implemented" : "Not offered"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-muted-gray">{dependency as string}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <MarketingCta
          title="Open a workspace without a subscription."
          description="Fabric does not request billing details. Sign in to create a persistent workspace and use the capabilities available in this deployment."
        />
      </main>
    </MarketingShell>
  );
}

const securityBoundaries: Array<{ icon: Icon; title: string; description: string }> = [
  { icon: KeyIcon, title: "Capability-based access", description: "Protected routes resolve the principal and resource, then check the exact workspace or board capability instead of trusting UI state." },
  { icon: WifiIcon, title: "Scoped realtime tickets", description: "Short-lived, board-scoped tickets, origin checks, revocation, quotas, and protocol permission checks protect room joins and updates." },
  { icon: CodeBracketSquareIcon, title: "Validated inputs", description: "API contracts reject malformed board data, comments, identifiers, AI requests, and oversized bodies before repository writes." },
  { icon: FingerPrintIcon, title: "Token-safe sharing", description: "Share links use high-entropy tokens that are hashed at rest, scoped to one board, permission limited, expirable, and revocable." },
  { icon: CloudArrowUpIcon, title: "Private asset storage", description: "Asset routes require board access and enforce byte-signature, media-type, per-file, and per-board limits before Neon storage." },
  { icon: SparklesIcon, title: "Constrained AI proposals", description: "The current skill can only create theme frames and move selected objects; Fabric validates the patch and requires an authorized approval." },
];

export function SecurityPage() {
  return (
    <MarketingShell>
      <main>
        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[7fr_5fr] lg:items-end`}>
            <div className="flex flex-col items-start gap-6">
              <Eyebrow>Security architecture</Eyebrow>
              <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
                Trust is a boundary, not a badge.
              </h1>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                 Fabric’s architecture treats every identifier, sync message, share link, upload, and AI tool call as untrusted until policy says otherwise.
              </p>
              <Link href="#threat-model" className={primaryLink}>
                Review Threat Model
                <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
              </Link>
            </div>

            <div className="flex flex-col gap-6 rounded-radius-3xl bg-light-surface-tint p-6 ring-1 ring-border-subtle sm:p-8">
              <ShieldCheckIcon className="size-12 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
              <div className="flex flex-col gap-3">
                <p className="font-mono text-sm uppercase tracking-wide text-sky-blue-accent">Current status</p>
                 <h2 className="text-2xl font-medium tracking-tight">Implemented controls, no external assurance claim.</h2>
                 <p className="text-pretty text-lg text-muted-gray sm:text-base">
                    The application includes scoped authorization, isolated runtime roles, hashed share tokens, and restricted realtime admission. This page does not claim independent penetration testing, compliance certification, or contractual service levels.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="threat-model" className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="Threat model"
              title="The boundaries Fabric enforces."
              description="The current application pairs concrete trust boundaries with server-side authorization, schemas, limits, and safe public responses."
            />
            <dl className="grid gap-x-10 gap-y-0 md:grid-cols-2">
              {securityBoundaries.map((boundary) => {
                const BoundaryIcon = boundary.icon;
                return (
                  <div key={boundary.title} className="flex gap-4 border-t border-border-subtle py-6">
                    <BoundaryIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <div className="flex min-w-0 flex-col gap-2">
                      <dt className="font-medium text-near-black-primary-text">{boundary.title}</dt>
                      <dd className="text-pretty text-lg text-muted-gray sm:text-base">{boundary.description}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <SectionHeading
              eyebrow="Request path"
              title="One policy model across every runtime."
              description="Next.js handlers, the realtime service, and the AI worker bind every operation to authenticated resource identifiers and narrow capabilities."
            />

            <div className="overflow-hidden rounded-radius-3xl bg-surface-white ring-1 ring-border-subtle">
              <ol role="list" className="grid md:grid-cols-4">
                {[
                  ["01", "Authenticate", "Establish the user, device, or narrow share-link identity."],
                  ["02", "Resolve scope", "Load tenant and resource inside the trusted data-access layer."],
                  ["03", "Check capability", "Authorize the exact read, write, share, export, or tool action."],
                  ["04", "Validate output", "Enforce schemas, quotas, redaction, and safe public responses."],
                ].map(([number, title, description], index) => (
                  <li
                    key={number}
                    className={`flex flex-col gap-4 p-5 ${index > 0 ? "border-t border-border-subtle md:border-t-0 md:border-l" : ""}`}
                  >
                    <p className="font-mono text-sm text-sky-blue-accent">{number}</p>
                    <div className="flex flex-col gap-2">
                      <h3 className="font-medium">{title}</h3>
                      <p className="text-pretty text-base text-muted-gray">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="border-y border-border-subtle bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-10 lg:grid-cols-2`}>
            <div className="flex flex-col gap-5">
              <p className="font-mono text-sm uppercase tracking-wide text-sky-blue-accent">Implemented safeguards</p>
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Checks on the active request paths.</h2>
              <ul role="list" className="flex flex-col gap-3">
                {[
                  "Same-origin checks on state-changing HTTP routes",
                  "Workspace and board capability checks inside the data-access path",
                  "Realtime ticket expiry, origin validation, revocation, and update limits",
                  "Schema, body-size, file-signature, and storage-quota enforcement",
                  "AI response validation plus exact saved-state verification before completion",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg text-muted-gray sm:text-base">
                    <CheckCircleIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-5 border-t border-near-black-primary-text/15 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
              <p className="font-mono text-sm uppercase tracking-wide text-muted-gray">Assurance boundary</p>
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Know what is not asserted.</h2>
              <ul role="list" className="flex flex-col gap-3">
                {[
                  "No security certification or regulatory compliance status",
                  "No published third-party penetration-test report",
                  "No contractual retention, deletion, backup, or uptime service level",
                  "No public incident-response or vulnerability-disclosure commitment",
                  "Deployment operators remain responsible for secrets, network controls, backups, monitoring, and provider configuration",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg text-muted-gray sm:text-base">
                    <NoSymbolIcon className="size-6 shrink-0 stroke-muted-gray" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <MarketingCta
          title="Inspect the controls with the assurance boundary in view."
          description="Fabric exposes implemented safeguards separately from certifications, contractual service levels, and deployment-operator responsibilities."
        />
      </main>
    </MarketingShell>
  );
}

const dataHandlingRows = [
  ["OAuth identity and sessions", "Name, email, avatar, provider account ID, database session, and hashed network metadata", "Provider access, refresh, and ID tokens are discarded before account persistence. Sessions expire or can be revoked."],
  ["Workspace and board content", "Workspaces, projects, roles, board snapshots, comments, share-link metadata, checkpoints, and media metadata in Neon; private upload bytes in Cloudflare R2", "Effective board access is checked for every read and mutation. Boards can be archived, links revoked, and replaced or abandoned media is removed through durable cleanup."],
  ["Realtime recovery state", "Principal-, board-, and generation-scoped IndexedDB state plus durable server updates", "Device state remains in that browser. Signing out ends the session but does not guarantee deletion of browser recovery data."],
  ["AI runs", "Instruction, bounded conversation and selected-canvas context, hashes, events, proposal, usage, and status in Fabric storage", "Only an explicit AI run calls the configured OpenAI-compatible streaming endpoint."],
  ["Security and session events", "Session timestamps, user-agent family, IP hash, and account security events", "These records support session visibility and revocation; the application does not publish a retention duration for them."],
];

export function PrivacyPage() {
  return (
    <MarketingShell>
      <main>
        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[7fr_5fr] lg:items-center`}>
            <div className="flex flex-col items-start gap-6">
              <Eyebrow>Privacy by explicit boundary</Eyebrow>
              <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
                Know where your work lives.
              </h1>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                Fabric distinguishes device-local recovery state, synchronized workspace data, identity records, and AI-provider requests because privacy depends on explicit boundaries.
              </p>
              <Link href="#data-flow" className={primaryLink}>
                Follow the Data Flow
                <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-radius-3xl bg-border-subtle ring-1 ring-border-subtle">
              {[
                [ComputerDesktopIcon, "On this device", "Cached board state and supported pending assets"],
                [CircleStackIcon, "Fabric storage", "Identity, sessions, workspaces, boards, assets, comments, checkpoints, and AI run records"],
                [WifiIcon, "Realtime service", "Authorized board updates while connected; ephemeral awareness is not written to board history"],
                [SparklesIcon, "AI provider", "The instruction and selected semantic objects for an explicit run, with provider storage requested off"],
              ].map(([icon, title, description]) => {
                const BoundaryIcon = icon as Icon;
                return (
                  <div key={title as string} className="flex min-h-44 flex-col gap-4 bg-surface-white p-5">
                    <BoundaryIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <div className="flex flex-col gap-1">
                      <h2 className="font-medium">{title as string}</h2>
                      <p className="text-pretty text-base text-muted-gray">{description as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="data-flow" className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="Data flow"
              title="Local first does not mean local only."
              description="A collaborative product must move data. The privacy job is to make each transition scoped, visible, authorized, and reversible where possible."
            />

            <ol role="list" className="grid overflow-hidden rounded-radius-3xl ring-1 ring-border-subtle md:grid-cols-4">
              {[
                [BoltIcon, "Create locally", "An edit appears immediately and enters a device-local durable queue."],
                [ArrowPathIcon, "Synchronize", "Authorized updates merge through the realtime service when a connection exists."],
                [CloudArrowUpIcon, "Store privately", "Snapshots, update tails, assets, comments, and checkpoints remain access-controlled."],
                [SparklesIcon, "Process deliberately", "Exports, share links, and explicit AI runs receive the resource data required for that action."],
              ].map(([icon, title, description], index) => {
                const StepIcon = icon as Icon;
                return (
                  <li key={title as string} className={`flex flex-col gap-4 bg-surface-white p-5 ${index > 0 ? "border-t border-border-subtle md:border-t-0 md:border-l" : ""}`}>
                    <StepIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <div className="flex flex-col gap-2">
                      <h3 className="font-medium">{title as string}</h3>
                      <p className="text-pretty text-base text-muted-gray">{description as string}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-10`}>
            <SectionHeading
              eyebrow="Current data handling"
              title="Implemented storage, without invented retention promises."
              description="This table maps the data the application stores and the controls it currently exposes. It does not imply a deletion or retention service level."
            />

            <div className="overflow-x-auto rounded-radius-3xl ring-1 ring-border-subtle">
              <table className="w-full min-w-4xl border-collapse text-left">
                <thead className="bg-light-surface-tint">
                  <tr>
                    <th scope="col" className="px-5 py-4 font-medium">Data Class</th>
                    <th scope="col" className="px-5 py-4 font-medium">Current Storage</th>
                    <th scope="col" className="px-5 py-4 font-medium">Current Boundary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-surface-white">
                  {dataHandlingRows.map(([dataClass, storage, boundary]) => (
                    <tr key={dataClass}>
                      <th scope="row" className="px-5 py-4 font-medium text-near-black-primary-text">{dataClass}</th>
                      <td className="px-5 py-4 text-muted-gray">{storage}</td>
                      <td className="px-5 py-4 text-muted-gray">{boundary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-y border-border-subtle bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-10 lg:grid-cols-2`}>
            <div className="flex flex-col gap-5">
              <ComputerDesktopIcon className="size-10 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Your device is a real storage location.</h2>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                Visited board state and pending work can remain in IndexedDB under the principal, board, and document generation. Signing out invalidates the Fabric session but does not currently guarantee that browser recovery data is erased.
              </p>
            </div>
            <div className="flex flex-col gap-5 border-t border-near-black-primary-text/15 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
              <SparklesIcon className="size-10 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">An AI run crosses another boundary.</h2>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                Fabric sends the instruction, bounded conversation, and selected-canvas context to the configured OpenAI-compatible model only after an editor starts a run. Requests are streamed and provider processing remains subject to the configured account, endpoint, and provider terms.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-8 lg:grid-cols-[3fr_2fr] lg:items-start`}>
            <div className="flex flex-col gap-4">
              <Eyebrow>Scope of this notice</Eyebrow>
              <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Product behavior, separated from contractual terms.</h2>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                This page describes behavior visible in the application and its repository. It does not provide a contractual retention period, deletion SLA, backup guarantee, subprocessor schedule, or compliance certification.
              </p>
            </div>
            <StatusNote>
              Deployment operators must verify their own OAuth settings, database backups, logs, AI-provider account terms, regional configuration, support process, and legal notices before relying on this overview.
            </StatusNote>
          </div>
        </section>

        <MarketingCta
          title="Review the boundary, then use the product."
          description="Fabric keeps device recovery, synchronized workspace data, identity records, and AI-provider requests distinct in both the interface and implementation."
        />
      </main>
    </MarketingShell>
  );
}

const accessibilityPrinciples: Array<{ icon: Icon; title: string; description: string }> = [
  { icon: QueueListIcon, title: "Semantic shared view", description: "A shared board can expose its stored semantic objects as an ordered DOM list alongside the read-only canvas." },
  { icon: CommandLineIcon, title: "Standard controls", description: "Workspace, account, member, comment, share, checkpoint, and AI flows use labeled buttons, links, dialogs, and form controls." },
  { icon: EyeIcon, title: "Visible focus and state", description: "Interactive controls expose focus, disabled, loading, error, sync, and approval states without relying on color alone." },
  { icon: LanguageIcon, title: "Known canvas boundary", description: "The tldraw editor provides its own keyboard and accessibility behavior, but Fabric does not claim a complete non-spatial authoring equivalent." },
];

export function AccessibilityPage() {
  return (
    <MarketingShell>
      <main>
        <section className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} flex flex-col gap-10`}>
            <div className="grid gap-10 lg:grid-cols-[7fr_5fr] lg:items-end">
              <div className="flex flex-col items-start gap-6">
                <Eyebrow>Accessibility architecture</Eyebrow>
                <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
                  The canvas is one view, not the whole interface.
                </h1>
                <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                  Fabric uses semantic application chrome, labeled form controls, visible focus, and a read-only list for shared board content while keeping the whiteboard’s current accessibility boundary explicit.
                </p>
                <Link href="#semantic-model" className={primaryLink}>
                  See the Semantic Model
                  <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
                </Link>
              </div>
              <StatusNote>
                The application has responsive, keyboard-aware product UI and a semantic shared-board view. It does not claim independent WCAG conformance, complete screen-reader canvas authoring, or real-device certification.
              </StatusNote>
            </div>
          </div>
        </section>

        <section id="semantic-model" className="border-y border-border-subtle bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="Shared-board representation"
              title="One shared board, two ways to inspect it."
              description="The public canvas and semantic list read the same saved board projection. The list is a reading aid, not a full editing replacement."
            />

            <div className="grid overflow-hidden rounded-radius-3xl bg-surface-white ring-1 ring-border-subtle lg:grid-cols-[3fr_2fr]">
              <div className="min-h-96 bg-light-surface-tint p-5 [background-image:linear-gradient(var(--color-border-subtle)_1px,transparent_1px),linear-gradient(90deg,var(--color-border-subtle)_1px,transparent_1px)] [background-size:32px_32px] sm:p-8">
                <div className="flex flex-col gap-5 rounded-radius-3xl border border-near-black-primary-text/15 bg-surface-white/90 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium">Onboarding findings</p>
                    <p className="font-mono text-sm text-muted-gray">Frame 1 of 3</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-radius-xl bg-[#d8c7aa] p-4 text-[#2f2a22]">
                      <p className="font-medium">Quote: I want to explore first.</p>
                    </div>
                    <div className="rounded-radius-xl bg-[#bcd2cb] p-4 text-[#20332f]">
                      <p className="font-medium">Theme: Preserve momentum.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
                    <RectangleGroupIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <p className="text-base text-muted-gray">Spatial canvas view · pan, zoom, select, arrange</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col border-t border-border-subtle lg:border-t-0 lg:border-l">
                <div className="flex h-12 items-center gap-3 border-b border-border-subtle px-5">
                  <QueueListIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                  <p className="font-medium">Read-only Board List</p>
                </div>
                <ol role="list" className="flex flex-1 flex-col divide-y divide-border-subtle">
                  {[
                    ["Frame", "Onboarding findings", "3 children"],
                    ["Note", "Quote: I want to explore first", "Position 180, 120"],
                    ["Note", "Theme: Preserve momentum", "Position 520, 120"],
                    ["Connector", "Quote to theme", "Straight route"],
                  ].map(([type, name, detail], index) => (
                    <li key={name} className={`flex gap-3 px-5 py-4 ${index === 1 ? "bg-sky-blue-accent/8" : ""}`}>
                      <p className="w-20 shrink-0 font-mono text-sm text-muted-gray">{type}</p>
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="font-medium">{name}</p>
                        <p className="text-base text-muted-gray">{detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <SectionHeading
              eyebrow="Core principles"
              title="Access starts outside the canvas pixels."
              description="Fabric keeps navigation, permissions, comments, sharing, recovery, and AI review in semantic controls, then states where canvas equivalence remains incomplete."
            />
            <dl className="grid gap-x-8 md:grid-cols-2">
              {accessibilityPrinciples.map((principle) => {
                const PrincipleIcon = principle.icon;
                return (
                  <div key={principle.title} className="flex gap-4 border-t border-border-subtle py-6">
                    <PrincipleIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <div className="flex min-w-0 flex-col gap-2">
                      <dt className="font-medium text-near-black-primary-text">{principle.title}</dt>
                      <dd className="text-pretty text-lg text-muted-gray sm:text-base">{principle.description}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        <section className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-10`}>
            <SectionHeading
              eyebrow="Keyboard path"
              title="Product workflows use ordinary controls."
              description="The application shell and collaboration workflows remain reachable through labeled links, buttons, forms, and dialogs; spatial authoring still depends on the canvas editor."
            />
            <div className="overflow-x-auto rounded-radius-3xl ring-1 ring-border-subtle">
              <table className="w-full min-w-2xl border-collapse text-left">
                <thead className="bg-light-surface-tint">
                  <tr>
                    <th scope="col" className="px-5 py-4 font-medium">Task</th>
                    <th scope="col" className="px-5 py-4 font-medium">Current Keyboard Path</th>
                    <th scope="col" className="px-5 py-4 font-medium">Boundary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-surface-white">
                  {[
                    ["Open or create a board", "Tab to the board link or Create Board button, then press Enter or Space", "Requires an authenticated workspace"],
                    ["Manage members", "Use the labeled email, role, and member action controls", "Owner capability required for changes"],
                    ["Read or write comments", "Open Comments and use the thread and reply forms", "Comment capability and sign-in rules apply"],
                    ["Review an AI proposal", "Use Instructions, Generate Proposal, Discard Preview, and Apply Proposal", "Requires an editable, fully synced board"],
                    ["Author on the canvas", "Use the tldraw toolbar and its keyboard commands", "No complete non-spatial editing equivalent is asserted"],
                  ].map(([task, keyboardPath, boundary]) => (
                    <tr key={task}>
                      <th scope="row" className="px-5 py-4 font-medium text-near-black-primary-text">{task}</th>
                      <td className="px-5 py-4 text-muted-gray">{keyboardPath}</td>
                      <td className="px-5 py-4 text-muted-gray">{boundary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="bg-light-surface-tint py-16 sm:py-20">
          <div className={`${pageContainer} flex flex-col gap-10`}>
            <SectionHeading
              eyebrow="Device contract"
              title="Different inputs, explicit scope."
              description="Responsive layouts adapt application controls by viewport while the dense whiteboard remains most capable with desktop-sized input and space."
            />
            <div className="grid gap-8 md:grid-cols-3">
              {[
                [ComputerDesktopIcon, "Desktop", "The complete workspace and whiteboard UI is available with mouse, trackpad, keyboard, and standard form controls."],
                [SquaresPlusIcon, "Tablet", "Responsive controls and the touch-capable canvas are available; no independent real-device certification is claimed."],
                [DevicePhoneMobileIcon, "Phone", "Workspace, shared-board, and comment surfaces adapt to narrow screens; dense canvas authoring remains viewport constrained."],
              ].map(([icon, title, description]) => {
                const DeviceIcon = icon as Icon;
                return (
                  <div key={title as string} className="flex flex-col gap-4 border-t border-near-black-primary-text/15 pt-5">
                    <DeviceIcon className="size-8 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <h3 className="text-xl font-medium">{title as string}</h3>
                    <p className="text-pretty text-lg text-muted-gray sm:text-base">{description as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <MarketingCta
          title="Accessibility is measurable, not a badge."
          description="Open Fabric to inspect its responsive controls, visible focus states, semantic application chrome, and explicit canvas boundary."
        />
      </main>
    </MarketingShell>
  );
}

const offlineSteps = [
  ["01", "Write locally", "Your input updates local state before a round trip."],
  ["02", "Persist safely", "Visited board state and supported pending assets enter device storage."],
  ["03", "Queue changes", "Unacknowledged updates remain identifiable instead of looking falsely synced."],
  ["04", "Merge on reconnect", "CRDT updates converge, while generation mismatches trigger recovery—not silent overwrite."],
];

export function AiOfflinePage() {
  return (
    <MarketingShell>
      <main>
        <section className="bg-surface-white py-12 sm:py-16 lg:py-20">
          <div className={`${pageContainer} grid gap-10 lg:grid-cols-[6fr_7fr] lg:items-center`}>
            <div className="flex flex-col items-start gap-6 lg:py-8">
              <Eyebrow>Local agency · Assisted synthesis</Eyebrow>
              <h1 className="max-w-[16ch] text-balance font-display text-5xl font-normal tracking-[-0.03em] sm:text-[4.375rem] lg:text-[5rem]">
                Keep thinking when the signal drops.
              </h1>
              <p className="max-w-[48ch] text-pretty text-lg text-muted-gray sm:text-base">
                Fabric keeps previously visited work useful offline. Its AI skill receives selected objects, streams a bounded proposal, and waits for your approval before changing the canvas.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/app" className={primaryLink}>
                  Get started
                  <ArrowRightIcon className="size-6 shrink-0 stroke-current" aria-hidden="true" />
                </Link>
                <Link href="#approval-loop" className={secondaryLink}>
                  See the Approval Loop
                </Link>
              </div>
            </div>

            <figure className="flex flex-col gap-3">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[min(1vw,14px)] bg-light-surface-tint outline-1 -outline-offset-1 outline-near-black-primary-text/5">
                <Image
                  src="/images/fabric-offline-fieldwork.webp"
                  alt="A researcher using a tablet with a spatial canvas during fieldwork away from a reliable network"
                  fill
                  priority
                  sizes="(min-width: 1024px) 54vw, 100vw"
                  className="object-cover"
                />
                <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-radius-xl bg-surface-white/90 px-3 py-2 shadow-sm ring-1 ring-near-black-primary-text/8 backdrop-blur-sm">
                  <span className="size-2 shrink-0 rounded-radius-pill bg-slate-button-dark pulse-dot" aria-hidden="true" />
                  <p className="font-mono text-sm text-near-black-primary-text">Offline · 7 changes safe on device</p>
                </div>
              </div>
              <figcaption className="text-base text-muted-gray">Illustration of Fabric’s fieldwork and unreliable-network use case.</figcaption>
            </figure>
          </div>
        </section>

        <section className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <SectionHeading
              eyebrow="Offline contract"
              title="Instant locally, honest about sync."
              description="Fabric applies input to local board state before network acknowledgement and keeps device-only, syncing, synced, offline, and recovery states distinct."
            />
            <ol role="list" className="grid gap-x-8 md:grid-cols-2">
              {offlineSteps.map(([number, title, description]) => (
                <li key={number} className="flex flex-col gap-3 border-t border-border-subtle py-6">
                  <p className="font-mono text-sm text-sky-blue-accent">{number}</p>
                  <h3 className="text-xl font-medium">{title}</h3>
                  <p className="text-pretty text-lg text-muted-gray sm:text-base">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="approval-loop" className="bg-surface-white py-16 sm:py-20 lg:py-24">
          <div className={`${pageContainer} flex flex-col gap-12`}>
            <SectionHeading
              eyebrow="AI contract"
              title="AI proposes. You decide."
              description="Fabric’s application-owned harness uses one bounded skill, selected context, operation budgets, permission checks, and one reviewable patch."
            />

            <div className="grid overflow-hidden rounded-radius-3xl bg-surface-white ring-1 ring-border-subtle lg:grid-cols-[3fr_4fr]">
              <div className="flex flex-col gap-6 p-6 sm:p-8">
                <div className="flex items-start gap-4">
                  <CommandLineIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="font-medium">Your request</p>
                    <p className="text-pretty text-lg text-muted-gray sm:text-base">“Cluster the selected interview notes and draft three opportunity statements.”</p>
                  </div>
                </div>
                <dl className="flex flex-col gap-4 border-t border-border-subtle pt-6">
                  {[
                    ["Context", "12 selected notes in one frame"],
                    ["Skill", "Cluster selected notes"],
                    ["Allowed tools", "Read selection · Propose nodes · Propose groups"],
                    ["Writes", "None until approval"],
                  ].map(([term, detail]) => (
                    <div key={term} className="flex items-start justify-between gap-4">
                      <dt className="font-medium text-near-black-primary-text">{term}</dt>
                      <dd className="text-right text-base text-muted-gray">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex flex-col gap-6 border-t border-border-subtle bg-sky-blue-accent/8 p-6 sm:p-8 lg:border-t-0 lg:border-l">
                <div className="flex items-start gap-4">
                  <SparklesIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="font-medium">Proposed patch</p>
                    <p className="text-pretty text-lg text-muted-gray sm:text-base">3 theme frames, 8 moved nodes. No source content deleted.</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Momentum", "4 notes"],
                    ["Control", "5 notes"],
                    ["Confidence", "3 notes"],
                  ].map(([theme, count]) => (
                    <div key={theme} className="rounded-radius-xl bg-surface-white p-4 ring-1 ring-border-subtle">
                      <p className="font-medium">{theme}</p>
                      <p className="pt-1 font-mono text-sm text-muted-gray">{count}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-5">
                  <span className="rounded-radius-xl bg-sky-blue-accent px-3 py-2 font-medium text-white">Apply Patch</span>
                  <span className="rounded-radius-xl bg-surface-white px-3 py-2 font-medium text-muted-gray ring-1 ring-border-subtle">Discard Preview</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border-subtle py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-12 lg:grid-cols-2`}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4">
                <p className="font-mono text-sm uppercase tracking-wide text-sky-blue-accent">AI may</p>
                <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Help transform selected context.</h2>
              </div>
              <ul role="list" className="flex flex-col gap-3">
                {[
                  "Read 2–40 selected notes, text blocks, frames, images, or shapes",
                  "Create labeled theme frames and propose moves for selected objects",
                  "Stream run progress and a schema-validated proposal preview",
                  "Reject stale board versions, oversized patches, or disallowed operations",
                  "Apply one approved patch and confirm its durable receipt",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg text-muted-gray sm:text-base">
                    <CheckCircleIcon className="size-6 shrink-0 stroke-sky-blue-accent" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-6 border-t border-near-black-primary-text/15 pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
              <div className="flex flex-col gap-4">
                <p className="font-mono text-sm uppercase tracking-wide text-muted-gray">AI may not</p>
                <h2 className="max-w-[35ch] text-balance text-3xl font-medium tracking-tight sm:text-4xl">Bypass ownership or hide a broad change.</h2>
              </div>
              <ul role="list" className="flex flex-col gap-3">
                {[
                  "Read unselected board content",
                  "Rewrite, resize, delete, or connect existing objects",
                  "Grant itself new tools, network access, or capabilities",
                  "Apply a proposal automatically or around authorization checks",
                  "Run without the configured worker and streaming model-provider connection",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg text-muted-gray sm:text-base">
                    <NoSymbolIcon className="size-6 shrink-0 stroke-muted-gray" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-surface-white py-16 sm:py-20">
          <div className={`${pageContainer} grid gap-10 lg:grid-cols-[3fr_2fr] lg:items-start`}>
            <SectionHeading
              eyebrow="What is real today"
              title="The core product path is implemented."
              description="Fabric connects authenticated editing, durable board storage, local recovery, comments, scoped sharing, realtime transport, and streamed AI proposals."
            />
            <StatusNote>
              Realtime room ownership is process-local, so multi-instance fan-out and update compaction are outside the current runtime. AI availability depends on worker health, OpenAI-compatible credentials, and provider quota.
            </StatusNote>
          </div>
        </section>

        <MarketingCta
          title="Keep approval between the model and the canvas."
          description="Open Fabric to review every proposed operation while local, syncing, synced, offline, and recovery states remain explicit."
        />
      </main>
    </MarketingShell>
  );
}
