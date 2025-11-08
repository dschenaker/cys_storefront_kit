import { useEffect } from "react";
export default function Home(){ useEffect(()=>{ window.location.href=window.location.pathname.replace(/\/?$/,"/cys/"); },[]); return null; }
