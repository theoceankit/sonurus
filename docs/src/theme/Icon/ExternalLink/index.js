import React from 'react';
import {translate} from '@docusaurus/Translate';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/external-link.svg';

// The app's external-link icon in place of Docusaurus' own; the label is the
// one Docusaurus gives it, so screen readers still hear that the link opens a
// new tab.
export default function IconExternalLink() {
  return (
    <AppIcon
      svg={Svg}
      size={12}
      className="app-icon--external"
      label={translate({
        id: 'theme.IconExternalLink.ariaLabel',
        message: '(opens in new tab)',
        description: 'The ARIA label for the external link icon',
      })}
    />
  );
}
