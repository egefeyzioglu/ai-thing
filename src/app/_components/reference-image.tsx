import clsx from "clsx";
import Image from "next/image";

type ReferenceImageProps = {
    url: string;
    onSelect: () => void;
    isSelected: boolean;
}

export default function ReferenceImage(props: ReferenceImageProps) {
    return (
        <div className={clsx("p-0.75", props.isSelected ? "bg-blue-500" : "hover:bg-blue-300")}>
            <Image width={100} height={100} alt="Reference Image" onClick={() => { props.onSelect() }} src={props.url} />
        </div>
    );
}