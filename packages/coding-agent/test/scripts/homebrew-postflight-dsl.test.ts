import { expect, test } from "bun:test";
import { generateCask } from "../../../../scripts/ci-release-homebrew";

const checksums = new Map([
	["xcsh-darwin-arm64.zip", "a".repeat(64)],
	["xcsh-darwin-x64.zip", "b".repeat(64)],
	["xcsh-darwin-arm64.dmg", "c".repeat(64)],
	["xcsh-darwin-x64.dmg", "d".repeat(64)],
]);

// Homebrew evaluates postflight_steps on a different receiver. Exercise real
// Ruby closure semantics: only the outer cask DSL exposes architecture/version.
const rubyDsl = String.raw`
require "json"
class InstallSteps
  def initialize(steps)
    @steps = steps
  end
  def run(executable, **options)
    @steps << { executable: executable, **options }
  end
end
class CaskDSL
  attr_reader :artifact, :steps, :download
  def initialize(platform)
    @platform = platform.to_sym
    @steps = []
  end
  def arch(**choices)
    @arch = choices.fetch(@platform) unless choices.empty?
    @arch
  end
  def version(value = nil)
    @version = value unless value.nil?
    @version
  end
  def sha256(**_choices); end
  def url(value)
    @download = value
  end
  def name(_value); end
  def desc(_value); end
  def homepage(_value); end
  def binary(value, **options)
    @artifact = { executable: value, **options }
  end
  def postflight_steps(&block)
    InstallSteps.new(@steps).instance_eval(&block)
  end
end
def cask(_token, &block)
  dsl = CaskDSL.new(ARGV.fetch(0))
  dsl.instance_eval(&block)
  puts JSON.generate({ artifact: dsl.artifact, steps: dsl.steps, download: dsl.download })
end
eval(STDIN.read, TOPLEVEL_BINDING, "generated-xcsh.rb")
`;

for (const version of ["25.2.3", "25.2.4", "25.3.0"]) {
	test.skipIf(Bun.which("ruby") === null).each(["arm", "intel"])(
		`Ruby postflight evaluates the ${version} %s cask with the selected executable`,
		platform => {
			const ruby = Bun.which("ruby");
			expect(ruby, "Ruby is required to verify Homebrew DSL receiver semantics").not.toBeNull();
			const result = Bun.spawnSync([ruby!, "-e", rubyDsl, platform], {
				stdin: Buffer.from(generateCask(version, `v${version}`, checksums)),
			});
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const evaluated = JSON.parse(result.stdout.toString());
			const arch = platform === "arm" ? "arm64" : "x64";
			const app = version !== "25.2.3";
			const executable = app ? `xcsh.app/Contents/MacOS/xcsh-darwin-${arch}` : "bin/xcsh";
			expect(evaluated.artifact).toEqual(app ? { executable, target: "xcsh" } : { executable });
			expect(evaluated.download).toBe(
				`https://github.com/f5-sales-demo/xcsh/releases/download/v${version}/xcsh-darwin-${arch}.${app ? "dmg" : "zip"}`,
			);
			expect(evaluated.steps).toEqual(
				["chrome", "office"].map(command => ({
					executable,
					args: [command, "recycle"],
					base: "staged_path",
					sudo: false,
					must_succeed: false,
				})),
			);
		},
	);
}
