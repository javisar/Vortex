import { ComponentEx, connect, translate } from '../../util/ComponentEx';
import { log } from '../../util/log';
import { setLanguage } from './actions';
import { nativeCountryName, nativeLanguageName } from './languagemap';

import * as React from 'react';
import { ControlLabel, FormControl, FormGroup } from 'react-bootstrap';

import update = require('react-addons-update');

import { readdir } from 'fs';
import * as path from 'path';

interface ILanguage {
  key: string;
  language: string;
  country?: string;
}

interface IConnectedProps {
  currentLanguage: string;
}

interface IActionProps {
  onSetLanguage: (language: string) => void;
}

interface IState {
  languages: ILanguage[];
}

type IProps = IActionProps & IConnectedProps;

class SettingsInterface extends ComponentEx<IProps, IState> {

  constructor(props) {
    super(props);

    this.state = {
      languages: [],
    };

    const localesPath = path.normalize(path.join(__dirname, '..', '..', '..', 'locales'));

    readdir(localesPath, (err, files) => {
      if (err) {
        log('warn', 'failed to read locales', err);
        return;
      }

      if (!('en' in files)) {
        files = files.concat(['en']);
      }

      const locales = files.map((key) => {
        let language = undefined;
        let country = undefined;

        if (key.includes('-')) {
          let [languageKey, countryKey] = key.split('-');
          language = nativeLanguageName(languageKey);
          country = nativeCountryName(countryKey);
        } else {
          language = nativeLanguageName(key);
        }
        return { key, language, country }; });

      this.setState(update(this.state, {
        languages: { $set: locales },
      }));
    });
  }

  public render(): JSX.Element {
    const { t, currentLanguage } = this.props;

    return (
      <form>
        <FormGroup controlId='languageSelect'>
          <ControlLabel>{t('Language') }</ControlLabel>
          <FormControl
            componentClass='select'
            onChange={this.selectLanguage}
            value={currentLanguage}
          >
            { this.state.languages.map((language) => { return this.renderLanguage(language); }) }
          </FormControl>
        </FormGroup>
      </form>
    );
  }

  private selectLanguage = (evt) => {
    let target: HTMLSelectElement = evt.target as HTMLSelectElement;
    this.props.onSetLanguage(target.value);
  }

  private languageName(language: ILanguage): string {
    return language.country === undefined
      ? language.language
      : `${language.language} (${language.country})`;
  }

  private renderLanguage(language: ILanguage): JSX.Element {
    return (
      <option key={language.key} value={language.key}>
      { this.languageName(language) }
      </option>
    );
  }
}

function mapStateToProps(state: any): IConnectedProps {
  return {
    currentLanguage: state.settings.interface.language,
  };
}

function mapDispatchToProps(dispatch: Function): IActionProps {
  return {
    onSetLanguage: (newLanguage: string): void => {
      dispatch(setLanguage(newLanguage));
    },
  };
}

export default
  translate(['common'], { wait: true })(
    connect(mapStateToProps, mapDispatchToProps)(
      SettingsInterface
    )
  );
