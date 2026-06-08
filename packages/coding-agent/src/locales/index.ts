import ar from "./ar.json" with { type: "json" };
import de from "./de.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import es from "./es.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };
import hi from "./hi.json" with { type: "json" };
import it from "./it.json" with { type: "json" };
import ja from "./ja.json" with { type: "json" };
import ko from "./ko.json" with { type: "json" };
import ptBr from "./pt-br.json" with { type: "json" };
import th from "./th.json" with { type: "json" };
import zhCn from "./zh-cn.json" with { type: "json" };
import zhTw from "./zh-tw.json" with { type: "json" };

export const locales: Record<string, Record<string, string>> = {
	en,
	ja,
	ko,
	"zh-cn": zhCn,
	"zh-tw": zhTw,
	fr,
	de,
	es,
	"pt-br": ptBr,
	it,
	ar,
	hi,
	th,
};
