import { ExploreAccordion } from "@/components/landing/explore-accordion";
import {
  ConnectedEvidenceSection,
  StartWorkingSection,
} from "@/components/landing/image-story-sections";
import { LandingHero } from "@/components/landing/hero";
import { ReviewModes } from "@/components/landing/review-modes";
import { LandingFooter } from "@/components/landing/site-footer";
import { LandingHeader } from "@/components/landing/site-header";
import { LandingSmoothScroll } from "@/components/landing/landing-smooth-scroll";
import { WorkflowStory } from "@/components/landing/workflow-story";

export function LandingMain() {
  return (
    <div className="isolate min-h-dvh overflow-hidden bg-white font-sans text-[#252b31] antialiased">
      <LandingSmoothScroll />
      <LandingHeader />
      <main>
        <LandingHero />
        <WorkflowStory />
        <ConnectedEvidenceSection />
        <ExploreAccordion />
        <ReviewModes />
        <StartWorkingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
