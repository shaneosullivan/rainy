import { InstallButton } from "./InstallButton";
import { RainMap } from "./RainMap";

export default function Home() {
  return (
    <main>
      {/* The map is the page; this text is for search engines and screen readers. */}
      <div className="visually-hidden">
        <h1>Live rain radar for Ireland</h1>
        <p>
          See where it&apos;s raining across Ireland right now. rainy.ie shows Met Éireann&apos;s rainfall radar,
          updated every 5 minutes, animated over a map of Ireland. Zoom in on Dublin, Cork, Galway, Limerick or your
          own town and scrub through the last hour of rain to see which way it&apos;s moving.
        </p>
      </div>
      <RainMap />
      <InstallButton />
    </main>
  );
}
