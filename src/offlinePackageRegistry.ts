import type {
  PackageRegistry,
  PackageResolveContext,
  PackageSpec,
} from '@myriaddreamin/typst.ts/internal.types'

/**
 * A deliberately network-free registry. Typst's built-in language and bundled
 * fonts remain available, while an unbundled @preview package fails instead of
 * making a synchronous request to packages.typst.org.
 */
export class OfflinePackageRegistry implements PackageRegistry {
  resolve(spec: PackageSpec, context: PackageResolveContext) {
    void spec
    void context
    return undefined
  }
}
