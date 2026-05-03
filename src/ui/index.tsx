import { render } from "preact";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("UI root element missing");

render(<App />, root);
