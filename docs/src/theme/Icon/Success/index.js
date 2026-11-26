import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/check.svg';

// The app's check icon in place of Docusaurus' own.
export default function IconSuccess({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}
