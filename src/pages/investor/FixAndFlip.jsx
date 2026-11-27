import React from 'react';
import { Hammer } from 'lucide-react';
import RoadmapPlaceholder from './RoadmapPlaceholder';

const FixAndFlip = () => (
    <RoadmapPlaceholder
        title="Fix & Flip"
        subtitle="Immobilien-Flipping-Projekte planen und verfolgen."
        icon={Hammer}
        hint="Fix & Flip-Deals lassen sich bereits im Investor-Portal unter „Deals“ anlegen und berechnen."
        linkTo="/investor-portal?tab=deals"
        linkLabel="Zu den Deals"
    />
);

export default FixAndFlip;
