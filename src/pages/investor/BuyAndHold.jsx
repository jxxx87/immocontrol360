import React from 'react';
import { TrendingUp } from 'lucide-react';
import RoadmapPlaceholder from './RoadmapPlaceholder';

const BuyAndHold = () => (
    <RoadmapPlaceholder
        title="Buy & Hold"
        subtitle="Langfristige Immobilieninvestments analysieren und verwalten."
        icon={TrendingUp}
        hint="Buy & Hold-Deals lassen sich bereits im Investor-Portal unter „Deals“ anlegen und berechnen."
        linkTo="/investor-portal?tab=deals"
        linkLabel="Zu den Deals"
    />
);

export default BuyAndHold;
