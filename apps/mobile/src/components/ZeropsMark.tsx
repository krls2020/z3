import Svg, { Path } from "react-native-svg";

/** Official two-tone Zerops mark, scaled for compact mobile navigation chrome. */
export function ZeropsMark(props: { readonly height: number }) {
  const aspectRatio = 42.27 / 50.48;
  return (
    <Svg
      accessibilityLabel="Zerops"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 42.27 50.48"
    >
      <Path
        d="M20.19.7L3 7.27A4 4 0 0 0 .46 11v16.54L8.36 23v-9.3L21.6 8.62V.44a4 4 0 0 0-1.41.26z"
        fill="#3cbdb2"
        transform="translate(-.46 -.44)"
      />
      <Path
        d="M8.5 37.74l13.1-7.55v-9.12L1.36 32.74a1.82 1.82 0 0 0-.9 1.56v6.11A4 4 0 0 0 3 44.1l17.19 6.57a4 4 0 0 0 1.41.26v-8.18z"
        fill="#3cbdb2"
        transform="translate(-.46 -.44)"
      />
      <Path
        d="M41.9 18.47a1.67 1.67 0 0 0 .84-1.47v-6a4 4 0 0 0-2.54-3.73L23 .7a4 4 0 0 0-1.4-.26v8.18l13 5-13 7.49v9.12z"
        fill="#00b1a3"
        transform="translate(-.46 -.44)"
      />
      <Path
        d="M23 50.67l17.2-6.57a4 4 0 0 0 2.54-3.69V23.7l-7.9 4.56v9.43L21.6 42.75v8.18a4 4 0 0 0 1.4-.26z"
        fill="#00b1a3"
        transform="translate(-.46 -.44)"
      />
    </Svg>
  );
}
