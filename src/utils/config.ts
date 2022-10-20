// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
/**
 * Responsible for loading, parsing and checking the config file for melon
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { log } from '../log'

export const projectDir = process.cwd()
export const configPath = join(projectDir, 'gluon.json')

let hasWarnedAboutConfig = false

export enum SupportedProducts {
  Firefox = 'firefox',
  FirefoxESR = 'firefox-esr',
  FirefoxDev = 'firefox-dev',
  FirefoxBeta = 'firefox-beta',
  FirefoxNightly = 'firefox-nightly',
}

export const validProducts = [
  SupportedProducts.Firefox,
  SupportedProducts.FirefoxESR,
  SupportedProducts.FirefoxDev,
  SupportedProducts.FirefoxBeta,
  SupportedProducts.FirefoxNightly,
]

export interface LicenseConfig {
  /**
   * What license you intend to put your project under. Currently MPL is the
   * only one supported by the license checker, but if you want implement more
   * please feel free to open a pull request.
   *
   * To disable the license checker, set this type to `unknown`
   */
  licenseType: 'MPL-2.0' | 'unknown'
  /**
   * Files to be ignored by the license checker. For default values see the
   * `defaultConfig` variable in the config.ts file
   *
   * These should be rejex tests because compiled regex tests are **really**
   * fast which will stop the license checker from becoming absurdly slow with
   * larger projects
   */
  ignoredFiles: string[]
}

export interface ReleaseInfo {
  /**
   * The version of your output product. E.g. 1.3.5
   */
  displayVersion: string
  github?: {
    repo: string
  }

  x86?: {
    windowsMar?: string
    macosMar?: string
    linuxMar?: string
  }
}

export interface GithubAddonInfo {
  platform: 'github'
  id: string
  repo: string
  version: string
  fileGlob: string
}

export interface AMOAddonInfo {
  platform: 'amo'
  id: string
  amoId: string
  version: string
}

export interface UrlAddonInfo {
  platform: 'url'
  version: string
  id: string
  url: string
}

export type AddonInfo = GithubAddonInfo | AMOAddonInfo | UrlAddonInfo

export interface Config {
  /**
   * The name of the product to build
   */
  name: string
  /**
   * The name of the company the build is for
   */
  vendor: string
  /**
   * e.g. co.dothq.melon
   */
  appId: string
  /**
   * The name of the application binary that will be generated by mach
   */
  binaryName: string
  /**
   * The license check config
   */
  license: LicenseConfig
  /**
   * This is the host name of your update server
   */
  updateHostname?: string
  version: {
    /**
     * What branch of firefox you are forking. e.g. stable ('firefox'), dev ('firefox-dev')
     * , esr ('firefox-esr') etc.
     *
     * For use in code, use {@link SupportedProducts}
     */
    product: SupportedProducts
    /**
     * The version of the selected product you are forking
     */
    version?: string
  }
  buildOptions: {
    generateBranding: boolean
    windowsUseSymbolicLinks: boolean
  }
  addons: Record<string, AddonInfo>
  brands: Record<
    string,
    {
      backgroundColor: string
      brandShorterName: string
      brandShortName: string
      brandFullName: string
      release: ReleaseInfo
    }
  >
}

export const defaultBrandsConfig = {
  backgroundColor: '#2B2A33',
  brandShorterName: 'Nightly',
  brandShortName: 'Nightly',
  brandFullName: 'Nightly',
}

export const defaultLicenseConfig: LicenseConfig = {
  ignoredFiles: ['.*\\.json'],
  licenseType: 'MPL-2.0',
}

export const defaultConfig: Config = {
  name: 'Unknown gluon build',
  vendor: 'Unknown',
  appId: 'unknown.appid',
  binaryName: 'firefox',
  version: {
    product: SupportedProducts.Firefox,
  },
  buildOptions: {
    generateBranding: true,
    windowsUseSymbolicLinks: false,
  },
  addons: {},
  brands: {},
  license: defaultLicenseConfig,
}

export function hasConfig(): boolean {
  return existsSync(configPath)
}

let mockConfig = ''

export function setMockRawConfig(config: string): void {
  mockConfig = config
}

export function rawConfig(): string {
  if (mockConfig != '') {
    return mockConfig
  }

  const configExists = hasConfig()

  let contents = '{}'

  if (configExists) {
    contents = readFileSync(configPath).toString()
  } else {
    if (!hasWarnedAboutConfig) {
      log.warning(
        `Config file not found at ${configPath}. It is recommended to create one by running |melon setup-project|`
      )
      hasWarnedAboutConfig = true
    }
  }

  return contents
}

export function getConfig(): Config {
  const fileContents = rawConfig()
  let fileParsed: Config

  try {
    // Try to parse the contents of the file. May not be valid JSON
    fileParsed = JSON.parse(fileContents)
  } catch (e) {
    // Report the error to the user
    log.error(`Error parsing melon config file located at ${configPath}`)
    log.error(e)
    process.exit(1)
  }

  // Provide some useful warnings to the user to help improve their config files
  if (!fileParsed.binaryName) {
    log.warning(
      'It is recommended that you provide a `binaryName` field in your config file, otherwise packaging may get messed up'
    )
  }

  // Merge the default config with the file parsed config
  fileParsed = { ...defaultConfig, ...fileParsed }

  fileParsed.license = { ...defaultLicenseConfig, ...fileParsed.license }

  // ===========================================================================
  // Config Validation

  if (!validProducts.includes(fileParsed.version.product)) {
    log.error(`${fileParsed.version.product} is not a valid product`)
    process.exit(1)
  }

  // Make sure that each addon conforms to the specification
  for (const addonKey in fileParsed.addons) {
    const addon = fileParsed.addons[addonKey]

    if (!addon.id)
      log.error(`The 'id' property was not provided for addon ${addonKey}`)

    if (addon.platform == 'url') {
      if (!addon.url)
        log.error(`The 'url' property was not provided for addon ${addonKey}`)

      continue
    }

    if (addon.platform == 'amo') {
      if (!addon.amoId)
        log.error(`The 'amoId' property was not provided for addon ${addonKey}`)

      if (!addon.version)
        log.error(
          `The 'version' property was not provided for addon ${addonKey}`
        )

      continue
    }

    if (addon.platform == 'github') {
      if (!addon.repo)
        log.error(`The 'repo' property was not provided for addon ${addonKey}`)

      if (!addon.version)
        log.error(
          `The 'version' property was not provided for addon ${addonKey}`
        )

      if (!addon.fileGlob)
        log.error(
          `The 'fileGlob' property was not provided for addon ${addonKey}`
        )

      continue
    }

    log.error(
      `Unknown addon platform ${(addon as { platform: string }).platform}`
    )
  }

  return fileParsed
}

export function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export const config = getConfig()
